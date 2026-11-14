// 对话区：滚动容器、贴底跟随、按会话记住落点、回到底部按钮、用户消息定位条与空会话起始提示。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentStatus, RunActivity, TranscriptItem } from "../../../shared/contract.ts";
import { oneLine } from "../../lib/format.ts";
import { pendingLines } from "../../lib/pending.ts";
import type { TurnFileChange } from "../../lib/turn-changes.ts";
import { groupTranscript } from "../../lib/turn-entries.ts";
import { cx } from "../../ui.tsx";
import { AssistantTurn } from "./AssistantTurn.tsx";
import { type MessageMark, MessageRail } from "./MessageRail.tsx";
import { MessageRow } from "./MessageRow.tsx";
import { PendingRow } from "./PendingRow.tsx";
import { RunStatus } from "./RunStatus.tsx";
import { ScrollToBottom } from "./ScrollToBottom.tsx";
import { useStepPhrase } from "./use-step-phrase.ts";

type TranscriptProps = {
	items: readonly TranscriptItem[];
	sessionId: string | null;
	/** 当前 workspace；null 时给出“先选 workspace”的空态。 */
	workspace: string | null;
	onAddWorkspace: () => void;
	status: AgentStatus;
	/** 运行中的当前步骤；状态行挂在对话尾部。 */
	activity: RunActivity | null;
	/** 已提交、还没被模型取走的插话正文；贴在对话尾部。 */
	queued: readonly string[];
	onWithdraw: () => void;
	showThinking: boolean;
	showUsage: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
	onOpenChanges: (changes: readonly TurnFileChange[], path: string) => void;
	onPrompt: (text: string) => void;
};

// 距底多少像素内算“贴底”。比这更远就认为读者在看上文，停止自动跟随。
const FOLLOW_THRESHOLD_PX = 80;

// 定位条悬停提示的长度：消息压成一行，超出就截断。
const RAIL_PREVIEW_CHARS = 120;

// 每个会话离开时的落点；anchorId 那条行压在视口顶上方 offset 像素处。

type SavedPosition = { pinned: true } | { pinned: false; anchorId: string | null; offset: number; scrollTop: number };

const STARTING_PROMPTS = ["Summarize this project", "Find a bug and fix it", "Add tests for a module"];

/** 对话区：自己持有滚动容器，默认贴底跟随新内容。 */
export function Transcript({
	items,
	sessionId,
	workspace,
	onAddWorkspace,
	status,
	activity,
	queued,
	onWithdraw,
	showThinking,
	showUsage,
	showToolDetails,
	onOpenExternal,
	onOpenChanges,
	onPrompt,
}: TranscriptProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const following = useRef(true);
	// 各会话的落点。切换会话回来靠它，不再一律落到底部。
	const positions = useRef(new Map<string, SavedPosition>());
	// 滚动的落点按会话记，事件回调里要用当前会话，不能读闭包里过期的那个。
	const session = useRef(sessionId);
	// 落点 effect 跑完前，这个 ref 停在旧会话上：那一次 commit 里 items effect 不能抢先贴底。
	const renderedSession = useRef<string | null>(null);
	// 落点恢复是个过程而不是一次写入：切换后的第一帧内容还在长高（远景行从估计高度变成真实高度、
	// 图片解码、流式增量），每次高度变化都要把落点重新对一遍，连续两次高度不变才收手。
	const restore = useRef<{ sessionId: string; saved: SavedPosition | undefined; height: number } | null>(null);
	const [showJump, setShowJump] = useState(false);

	// 父组件每次渲染都会给出新的回调引用；这里转成稳定引用，行组件的 memo 才不会被它打断。
	const callbacks = useRef({ onOpenExternal, onPrompt });
	useEffect(() => {
		callbacks.current = { onOpenExternal, onPrompt };
	}, [onOpenExternal, onPrompt]);
	const openExternal = useCallback((url: string) => callbacks.current.onOpenExternal(url), []);
	const prompt = useCallback((text: string) => callbacks.current.onPrompt(text), []);

	const marks = useMemo<MessageMark[]>(
		() =>
			items.flatMap((item) =>
				item.kind === "user" ? [{ id: item.id, preview: oneLine(item.text, RAIL_PREVIEW_CHARS) }] : [],
			),
		[items],
	);

	// 状态行的播报文案：算在这里，交给下面滚动区之外那个常驻的 live region。
	const phrase = useStepPhrase(activity);

	// 一次提问会来回好几个 loop，它们是同一轮：并成一块才能在收起时只占一行。
	const blocks = useMemo(() => groupTranscript(items), [items]);

	// 队列里的原始文本 → 一行行气泡；附件块在这里剥掉。
	const pending = useMemo(() => pendingLines(queued), [queued]);

	// 这一轮到底还在不在跑：status 在两次 run 之间会翻回 idle（自动重试、排队消息、压缩后继续都还没结束），
	// 只有 agent_settled 才真结束、那时步骤才清空——所以“活动还在”比 status 更接近整轮的生命周期。
	const busy = status === "running" || activity !== null;

	// 只有最后一条回答才可能“还在进行中”：中间跑工具时没有流式消息，不能拿它判断整轮结束。
	const liveTurnKey = busy ? (blocks.findLast((block) => block.kind === "turn")?.key ?? null) : null;

	// 记住当前会话的落点。贴底只存一个标记；离底存“视口顶部那条行 + 偏移”，
	// 像素值会随回来时的内容高度漂移，行的身份不会。
	const remember = useCallback(() => {
		const node = scrollRef.current;
		const id = session.current;
		if (!node || id === null) return;
		if (following.current) {
			positions.current.set(id, { pinned: true });
			return;
		}
		const edge = node.getBoundingClientRect().top;
		let anchorId: string | null = null;
		let offset = 0;
		for (const element of node.querySelectorAll<HTMLElement>(".message-row[data-item-id]")) {
			const top = element.getBoundingClientRect().top - edge;
			if (top > 0) break;
			anchorId = element.dataset.itemId ?? null;
			offset = top;
		}
		positions.current.set(id, { pinned: false, anchorId, offset, scrollTop: node.scrollTop });
	}, []);

	const finishRestore = useCallback(() => {
		const node = scrollRef.current;
		const pending = restore.current;
		restore.current = null;
		if (!node || pending === null) return;
		if (pending.sessionId === session.current) applySavedPosition(node, pending.saved);
	}, []);

	const stepRestore = useCallback(() => {
		const node = scrollRef.current;
		const pending = restore.current;
		if (!node || pending === null) return;
		applySavedPosition(node, pending.saved);
		const height = node.scrollHeight;
		if (height === pending.height) {
			finishRestore();
			return;
		}
		pending.height = height;
	}, [finishRestore]);

	// 当前这一步的身份：activity 每次 emit 都是新对象，用这个字符串做依赖才不会在无关刷新时重跑。
	const step = activity === null ? null : `${activity.kind}:${activity.tool ?? ""}:${activity.startedAt}`;

	// 贴底时跟着新内容走：每次内容变化只读写一次布局，不做逐条测量的重活。
	useLayoutEffect(() => {
		const node = scrollRef.current;
		// 会话刚切过来的那一次由下面的落点 effect 负责：这里贴底会把恢复的位置冲掉。
		if (renderedSession.current !== sessionId) return;
		// items 让这个效果跟着新记录和增量重跑；step 代表“当前这一步变了”，
		// 让状态行的出现、换步和消失也把视图带到新高度。
		if (!node || (items.length === 0 && step === null && pending.length === 0)) return;
		// 落点还没稳定：交给 stepRestore，这里贴底会把恢复的位置冲掉。
		if (restore.current !== null) return;
		if (!following.current) {
			// 读者停在上文时只提个醒，绝不抢走正在看的位置。
			setShowJump(true);
			return;
		}
		node.scrollTop = node.scrollHeight;
		remember();
	}, [items, step, pending.length, sessionId, remember]);

	// 切换会话：回到上个会话离开时的落点，第一次打开的会话落到底部。
	useLayoutEffect(() => {
		session.current = sessionId;
		renderedSession.current = sessionId;
		const saved = sessionId === null ? undefined : positions.current.get(sessionId);
		restore.current = null;
		following.current = saved?.pinned ?? true;
		setShowJump(saved !== undefined && !saved.pinned);
		const node = scrollRef.current;
		if (!node) return;
		// 没有活动会话时内容为空，也无处可跳。
		if (sessionId === null) return;
		restore.current = { sessionId, saved, height: node.scrollHeight };
		applySavedPosition(node, saved);
		requestAnimationFrame(() => stepRestore());
	}, [sessionId, stepRestore]);

	// 内容长高就再对一次落点，直到连续两次高度相同。图片、高亮、折叠块的长高都落在这里。
	useEffect(() => {
		const node = scrollRef.current;
		const content = node?.firstElementChild;
		if (!node || !(content instanceof HTMLElement)) return;
		const observer = new ResizeObserver(() => stepRestore());
		observer.observe(content);
		return () => observer.disconnect();
	}, [stepRestore]);

	const handleScroll = useCallback(() => {
		const node = scrollRef.current;
		if (!node) return;
		// 代码自己写的 scrollTop 也会产生滚动事件，按它算会把“还在底部”误判成用户离开了底部。
		if (restore.current !== null) return;
		following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_THRESHOLD_PX;
		// 重新贴底就把提示收掉；离底时按钮要等新内容到达才出现，由上面的效果负责。
		if (following.current) setShowJump(false);
		remember();
	}, [remember]);

	const handleWheel = useCallback(
		(event: React.WheelEvent<HTMLDivElement>) => {
			if (event.deltaY >= 0) return;
			if (restore.current !== null) finishRestore();
			const node = scrollRef.current;
			if (!node || node.scrollHeight <= node.clientHeight + FOLLOW_THRESHOLD_PX) return;
			// 向上滚的意图早于滚动事件到达：先停跟随，下一帧才不会被拽回底部。
			following.current = false;
		},
		[finishRestore],
	);

	const jumpToLatest = useCallback(() => {
		finishRestore();
		following.current = true;
		setShowJump(false);
		const node = scrollRef.current;
		if (!node) return;
		remember();
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		node.scrollTo({ top: node.scrollHeight, behavior: reduced ? "auto" : "smooth" });
	}, [remember, finishRestore]);

	/** 跳到某条用户消息：顶对齐，并停掉跟随，否则下一条增量会把视图拽回底部。 */
	const jumpToMessage = useCallback(
		(id: string, behavior: ScrollBehavior) => {
			const node = scrollRef.current;
			if (!node) return;
			const target = node.querySelector<HTMLElement>(`.message-row[data-item-id="${CSS.escape(id)}"]`);
			if (!target) return;
			finishRestore();
			following.current = false;
			setShowJump(false);
			const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			const top = target.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop - 8;
			node.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : behavior });
		},
		[finishRestore],
	);

	return (
		<div className="chat-surface">
			{/*
			  播报节点必须在滚动容器之外：那个容器本身是 role="log" aria-live="polite"，
			  嵌进去会重复播报，且运行中 aria-busy=true 会把变更压到整轮结束才呈现。
			  节点常驻：换步骤只改这里的文字，重挂出来的新节点不会被播报。
			*/}
			<span className="sr-only" aria-live="polite">
				{phrase ?? ""}
			</span>
			<div className="transcript-body">
				<div
					ref={scrollRef}
					className="transcript-scroll"
					role="log"
					aria-live="polite"
					aria-busy={busy}
					onScroll={handleScroll}
					onWheel={handleWheel}
				>
					<div className={cx("transcript-content", items.length === 0 && pending.length === 0 && "is-empty")}>
						{items.length === 0 && pending.length === 0 ? (
							<EmptyConversation workspace={workspace} onAddWorkspace={onAddWorkspace} onPrompt={prompt} />
						) : (
							blocks.map((block) =>
								block.kind === "turn" ? (
									<AssistantTurn
										key={block.key}
										items={block.items}
										live={block.key === liveTurnKey}
										showThinking={showThinking}
										showUsage={showUsage}
										showToolDetails={showToolDetails}
										onOpenExternal={openExternal}
										onOpenChanges={onOpenChanges}
									/>
								) : (
									<MessageRow key={block.key} item={block.item} sessionId={sessionId} />
								),
							)
						)}
						<PendingRow lines={pending} onWithdraw={onWithdraw} />
						{activity !== null ? <RunStatus /> : null}
					</div>
				</div>
				{/* 只有一条用户消息时没有可去的地方，定位条不占宽度。 */}
				{marks.length > 1 ? <MessageRail marks={marks} scroller={scrollRef} onJump={jumpToMessage} /> : null}
			</div>
			{showJump ? <ScrollToBottom onClick={jumpToLatest} /> : null}
		</div>
	);
}

/** 把滚动容器放回某个会话的落点；没有记录过就落到底部。 */
function applySavedPosition(node: HTMLDivElement, saved: SavedPosition | undefined): void {
	if (saved === undefined || saved.pinned) {
		node.scrollTop = node.scrollHeight;
		return;
	}
	const target =
		saved.anchorId === null
			? null
			: node.querySelector<HTMLElement>(`.message-row[data-item-id="${CSS.escape(saved.anchorId)}"]`);
	// 锚点行可能已经不在了（会话被压缩、消息被删）：退回像素值，至少不离得太远。
	if (target === null) {
		node.scrollTop = saved.scrollTop;
		return;
	}
	const top = target.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop - saved.offset;
	node.scrollTop = Math.max(0, top);
}

/** 空会话：没有 workspace 时先请用户选一个，选好了才给工作目录和起始提示。 */
function EmptyConversation({
	workspace,
	onAddWorkspace,
	onPrompt,
}: {
	workspace: string | null;
	onAddWorkspace: () => void;
	onPrompt: (text: string) => void;
}) {
	if (workspace === null) {
		return (
			<div className="chat-empty">
				<span className="chat-empty-label">No workspace selected</span>
				<p className="chat-empty-hint">Pick a workspace under the composer, or add a folder to start chatting.</p>
				<div className="chat-empty-prompts">
					<button type="button" className="chat-empty-prompt" onClick={onAddWorkspace}>
						Add workspace…
					</button>
				</div>
			</div>
		);
	}
	return (
		<div className="chat-empty">
			<span className="chat-empty-label">Working directory</span>
			<span className="chat-empty-path" title={workspace}>
				{workspace}
			</span>
			<div className="chat-empty-prompts">
				{STARTING_PROMPTS.map((text) => (
					<button key={text} type="button" className="chat-empty-prompt" onClick={() => onPrompt(text)}>
						{text}
					</button>
				))}
			</div>
		</div>
	);
}
