// 一轮回答里相邻的思考与工具调用：合成一条可折叠的“活动链”，标题给出数量、耗时与运行状态。

import { useId, useState } from "react";
import { IconChevronRight, IconZap } from "../../icons.tsx";
import { formatDuration } from "../../lib/format.ts";
import type { ActivityBlock } from "../../lib/turn-entries.ts";
import { cx } from "../../ui.tsx";
import { Markdown } from "../Markdown.tsx";
import { ToolRow } from "./ToolRow.tsx";

type TurnActivityProps = {
	blocks: readonly ActivityBlock[];
	/** 本轮还在接收增量：折叠链自动展开，收尾后回到一行摘要。 */
	streaming: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
};

/**
 * 一条思考链。链内思考直接铺开、工具各自保留自己的展开行：链只负责“这一串要不要看”，
 * 不再多套一层思考折叠。
 */
export function TurnActivity({ blocks, streaming, showToolDetails, onOpenExternal }: TurnActivityProps) {
	// null 表示沿用默认；点过标题后以自己的选择为准。
	const [choice, setChoice] = useState<boolean | null>(null);
	const bodyId = useId();
	const running = streaming || blocks.some(isRunning);
	const open = choice ?? (showToolDetails || running);
	return (
		<div className={cx("tool-activity-group", "turn-activity", open && "open", running && "active")}>
			<button
				type="button"
				className="tool-activity-header"
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={() => setChoice(!open)}
			>
				<span className="tool-activity-icon" aria-hidden>
					<IconZap size={14} />
				</span>
				<span className={cx("tool-activity-label", running && "running")}>{describe(blocks)}</span>
				{running ? <span className="activity-marker" aria-hidden /> : null}
				{duration(blocks) ? <span className="tool-activity-count">{`· ${duration(blocks)}`}</span> : null}
				<span className="tool-activity-caret" aria-hidden>
					<IconChevronRight size={12} />
				</span>
			</button>
			{open ? (
				<div className="tool-activity-collapse">
					<div className="tool-activity-collapse-inner">
						<div className="tool-activity-body turn-activity-body" id={bodyId}>
							{blocks.map((block) =>
								block.kind === "thinking" ? (
									<div key={block.key} className="turn-activity-thinking prose-chat thinking-prose">
										<Markdown source={block.text} onOpenExternal={onOpenExternal} />
									</div>
								) : (
									block.calls.map((call) => (
										<ToolRow key={call.id} call={call} showDetails={showToolDetails} />
									))
								),
							)}
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

/** 标题摘要：先工具后思考，数量为 0 的部分不出现。 */
function describe(blocks: readonly ActivityBlock[]): string {
	const tools = blocks.reduce((total, block) => total + (block.kind === "tools" ? block.calls.length : 0), 0);
	const thoughts = blocks.reduce((total, block) => total + (block.kind === "thinking" ? 1 : 0), 0);
	const parts: string[] = [];
	if (tools > 0) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
	if (thoughts > 0) parts.push(thoughts === 1 ? "thought" : `${thoughts} thoughts`);
	return parts.join(" · ");
}

/** 仍在进行的一环：工具没跑完。 */
function isRunning(block: ActivityBlock): boolean {
	if (block.kind === "thinking") return false;
	return block.calls.some((call) => call.state === "pending" || call.state === "running");
}

/** 累计耗时只加已记录到的那部分，还在跑的工具不参与统计。 */
function duration(blocks: readonly ActivityBlock[]): string {
	let total = 0;
	for (const block of blocks) {
		if (block.kind !== "tools") continue;
		for (const call of block.calls) {
			if (call.durationMs !== null) total += call.durationMs;
		}
	}
	return total > 0 ? formatDuration(total) : "";
}
