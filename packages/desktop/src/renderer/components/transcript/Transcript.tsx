// 对话区：滚动容器、贴底跟随、回到底部按钮与空会话起始提示。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentStatus, TranscriptItem } from "../../../shared/contract.ts";
import { cx } from "../../ui.tsx";
import { MessageRow } from "./MessageRow.tsx";
import { ScrollToBottom } from "./ScrollToBottom.tsx";

type TranscriptProps = {
	items: readonly TranscriptItem[];
	sessionId: string | null;
	cwd: string;
	status: AgentStatus;
	showThinking: boolean;
	showUsage: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
	onPrompt: (text: string) => void;
};

// 距底多少像素内算“贴底”。比这更远就认为读者在看上文，停止自动跟随。
const FOLLOW_THRESHOLD_PX = 80;

const STARTING_PROMPTS = ["Summarize this project", "Find a bug and fix it", "Add tests for a module"];

/** 对话区：自己持有滚动容器，默认贴底跟随新内容。 */
export function Transcript({
	items,
	sessionId,
	cwd,
	status,
	showThinking,
	showUsage,
	showToolDetails,
	onOpenExternal,
	onPrompt,
}: TranscriptProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const following = useRef(true);
	const [showJump, setShowJump] = useState(false);

	// 父组件每次渲染都会给出新的回调引用；这里转成稳定引用，行组件的 memo 才不会被它打断。
	const callbacks = useRef({ onOpenExternal, onPrompt });
	useEffect(() => {
		callbacks.current = { onOpenExternal, onPrompt };
	}, [onOpenExternal, onPrompt]);
	const openExternal = useCallback((url: string) => callbacks.current.onOpenExternal(url), []);
	const prompt = useCallback((text: string) => callbacks.current.onPrompt(text), []);

	// 贴底时跟着新内容走：每次内容变化只读写一次布局，不做逐条测量的重活。
	useLayoutEffect(() => {
		const node = scrollRef.current;
		// items 的长度读在这里：它是让这个效果跟着新记录和增量重跑的依赖。
		if (!node || items.length === 0) return;
		if (!following.current) {
			// 读者停在上文时只提个醒，绝不抢走正在看的位置。
			setShowJump(true);
			return;
		}
		node.scrollTop = node.scrollHeight;
	}, [items]);

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
	}, []);

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

	return (
		<div className="chat-surface">
			<div
				ref={scrollRef}
				className="transcript-scroll"
				role="log"
				aria-live="polite"
				aria-busy={status === "running"}
				onScroll={handleScroll}
				onWheel={handleWheel}
			>
				<div className={cx("transcript-content", items.length === 0 && "is-empty")}>
					{items.length === 0 ? (
						<EmptyConversation cwd={cwd} onPrompt={prompt} />
					) : (
						items.map((item) => (
							<MessageRow
								key={item.id}
								item={item}
								showThinking={showThinking}
								showUsage={showUsage}
								showToolDetails={showToolDetails}
								onOpenExternal={openExternal}
							/>
						))
					)}
				</div>
			</div>
			{showJump ? <ScrollToBottom onClick={jumpToLatest} /> : null}
		</div>
	);
}

/** 空会话：给出工作目录和几个点开就能发的起始提示。 */
function EmptyConversation({ cwd, onPrompt }: { cwd: string; onPrompt: (text: string) => void }) {
	return (
		<div className="chat-empty">
			<span className="chat-empty-label">Working directory</span>
			<span className="chat-empty-path" title={cwd}>
				{cwd}
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
