// 对话区：滚动容器、贴底跟随、回到底部按钮、用户消息定位条与空会话起始提示。

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
	const [showJump, setShowJump] = useState(false);
	// 定位条点亮的格是“视口顶部那条用户消息”；滚动事件按帧合并后才重算。
	const [activeUser, setActiveUser] = useState<string | null>(null);
	const syncFrame = useRef<number | null>(null);

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

	// 读的是每行的实际位置：折叠块、图片、markdown 长高都会改它，所以只在滚动时读一次。
	const syncActiveUser = useCallback(() => {
		const node = scrollRef.current;
		if (!node) return;
		const edge = node.getBoundingClientRect().top + 8;
		let current: string | null = null;
		for (const element of node.querySelectorAll<HTMLElement>(".message-row.user[data-item-id]")) {
			if (element.getBoundingClientRect().top > edge) break;
			current = element.dataset.itemId ?? null;
		}
		setActiveUser(current);
	}, []);

	const scheduleSync = useCallback(() => {
		if (syncFrame.current !== null) return;
		syncFrame.current = requestAnimationFrame(() => {
			syncFrame.current = null;
			syncActiveUser();
		});
	}, [syncActiveUser]);

	useEffect(
		() => () => {
			if (syncFrame.current !== null) cancelAnimationFrame(syncFrame.current);
		},
		[],
	);

	// 当前这一步的身份：activity 每次 emit 都是新对象，用这个字符串做依赖才不会在无关刷新时重跑。
	const step = activity === null ? null : `${activity.kind}:${activity.tool ?? ""}:${activity.startedAt}`;

	// 贴底时跟着新内容走：每次内容变化只读写一次布局，不做逐条测量的重活。
	useLayoutEffect(() => {
		const node = scrollRef.current;
		// items 让这个效果跟着新记录和增量重跑；step 代表“当前这一步变了”，
		// 让状态行的出现、换步和消失也把视图带到新高度。
		if (!node || (items.length === 0 && step === null && pending.length === 0)) return;
		if (!following.current) {
			// 读者停在上文时只提个醒，绝不抢走正在看的位置。
			setShowJump(true);
			return;
		}
		node.scrollTop = node.scrollHeight;
	}, [items, step, pending.length]);

	// 切换会话直接落到底部：上个会话的滚动位置和暂停状态都不带过来。
	useLayoutEffect(() => {
		following.current = true;
		setShowJump(false);
		const node = scrollRef.current;
		// 没有活动会话时内容为空，也无处可跳。
		if (!node || sessionId === null) return;
		node.scrollTop = node.scrollHeight;
	}, [sessionId]);

	const handleScroll = useCallback(() => {
		const node = scrollRef.current;
		if (!node) return;
		following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= FOLLOW_THRESHOLD_PX;
		// 重新贴底就把提示收掉；离底时按钮要等新内容到达才出现，由上面的效果负责。
		if (following.current) setShowJump(false);
		scheduleSync();
	}, [scheduleSync]);

	const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
		if (event.deltaY >= 0) return;
		const node = scrollRef.current;
		if (!node || node.scrollHeight <= node.clientHeight + FOLLOW_THRESHOLD_PX) return;
		// 向上滚的意图早于滚动事件到达：先停跟随，下一帧才不会被拽回底部。
		following.current = false;
	}, []);

	const jumpToLatest = useCallback(() => {
		following.current = true;
		setShowJump(false);
		const node = scrollRef.current;
		if (!node) return;
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		node.scrollTo({ top: node.scrollHeight, behavior: reduced ? "auto" : "smooth" });
	}, []);

	/** 跳到某条用户消息：顶对齐，并停掉跟随，否则下一条增量会把视图拽回底部。 */
	const jumpToMessage = useCallback((id: string, behavior: ScrollBehavior) => {
		const node = scrollRef.current;
		if (!node) return;
		const target = node.querySelector<HTMLElement>(`.message-row[data-item-id="${CSS.escape(id)}"]`);
		if (!target) return;
		following.current = false;
		setShowJump(false);
		setActiveUser(id);
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const top = target.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop - 8;
		node.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : behavior });
	}, []);

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
				{marks.length > 1 ? <MessageRail marks={marks} activeId={activeUser} onJump={jumpToMessage} /> : null}
			</div>
			{showJump ? <ScrollToBottom onClick={jumpToLatest} /> : null}
		</div>
	);
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
				<p className="chat-empty-hint">Pick a workspace in the sidebar, or add a folder to start chatting.</p>
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
