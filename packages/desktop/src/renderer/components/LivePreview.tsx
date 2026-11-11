// 模型输出的一行实时预览：发送后立刻有反馈，流式内容按最后一行的尾部滚动。

import type { AgentStatus, TranscriptItem } from "../../shared/contract.ts";

/** 预览行最多显示这么多字符，再多就截掉。 */
const PREVIEW_LIMIT = 120;

type LivePreviewProps = {
	items: readonly TranscriptItem[];
	status: AgentStatus;
};

/**
 * 悬在输入框上方的一条预览。运行中才有：先说明在等模型，收到内容后换成最新一行的尾部，
 * 每帧跟着 transcript 快照刷新，所以不用展开对话区也能看到模型在说什么。
 */
export function LivePreview({ items, status }: LivePreviewProps) {
	const text = livePreview(items, status);
	if (text === null) return null;
	return (
		<div className="live-preview" aria-live="polite">
			<span className="live-preview-dot" aria-hidden />
			<span className="live-preview-text" title={text}>
				{text}
			</span>
		</div>
	);
}

/** 预览文字：最后一条 assistant 的最后一行的尾部；还在跑工具时显示那个工具。 */
export function livePreview(items: readonly TranscriptItem[], status: AgentStatus): string | null {
	if (status !== "running") return null;
	const last = items.at(-1);
	if (last?.kind !== "assistant") return "Waiting for the model…";
	for (let index = last.parts.length - 1; index >= 0; index -= 1) {
		const part = last.parts[index];
		if (part.type === "tool") {
			// 文本还没到，但工具在跑：这时候的“输出”就是这个工具。
			if (part.call.state === "running" || part.call.state === "pending") return part.call.summary;
			continue;
		}
		const line = tailLine(part.text);
		if (line) return line;
	}
	return "Waiting for the model…";
}

/** 取最后一行非空内容，过长时保留尾部——读者关心的是刚说出口的那句。 */
function tailLine(text: string): string {
	const lines = text.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = (lines[index] ?? "").trim();
		if (line === "") continue;
		return line.length > PREVIEW_LIMIT ? `…${line.slice(-PREVIEW_LIMIT)}` : line;
	}
	return "";
}
