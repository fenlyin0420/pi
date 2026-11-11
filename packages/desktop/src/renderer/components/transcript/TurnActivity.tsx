// 一轮回答的活动行：思考、工具调用与中途草稿全折进这里，标题一行说明数量或当前在做什么。

import { useId, useState } from "react";
import { IconChevronRight, IconZap } from "../../icons.tsx";
import { formatDuration } from "../../lib/format.ts";
import type { ActivityBlock, TurnEntry } from "../../lib/turn-entries.ts";
import { cx } from "../../ui.tsx";
import { Markdown } from "../Markdown.tsx";
import { ToolRow } from "./ToolRow.tsx";

type TurnActivityProps = {
	entries: readonly TurnEntry[];
	/** 这一轮还在跑：标题换成当前步骤的预览，带运行标记。 */
	running: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
};

/**
 * 一整轮的过程行。默认折叠成一行：静态时给“几个工具 · 几段思考 · 耗时”，
 * 运行中给当前步骤（`bash npm test`、`Thinking`），展开后按原顺序铺开思考、工具与中途草稿。
 */
export function TurnActivity({ entries, running, showToolDetails, onOpenExternal }: TurnActivityProps) {
	const [open, setOpen] = useState(false);
	const bodyId = useId();
	const duration = running ? 0 : totalDuration(entries);
	return (
		<div className={cx("tool-activity-group", "turn-activity", open && "open", running && "active")}>
			<button
				type="button"
				className="tool-activity-header"
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={() => setOpen(!open)}
			>
				<span className="tool-activity-icon" aria-hidden>
					<IconZap size={14} />
				</span>
				<span className={cx("tool-activity-label", running && "running")}>
					{running ? describeStep(entries) : describe(entries)}
				</span>
				{running ? <span className="activity-marker" aria-hidden /> : null}
				{duration > 0 ? <span className="tool-activity-count">{`· ${formatDuration(duration)}`}</span> : null}
				<span className="tool-activity-caret" aria-hidden>
					<IconChevronRight size={12} />
				</span>
			</button>
			{open ? (
				<div className="tool-activity-collapse">
					<div className="tool-activity-collapse-inner">
						<div className="tool-activity-body turn-activity-body" id={bodyId}>
							{entries.map((entry) =>
								entry.kind === "text" ? (
									<div key={entry.key} className="turn-activity-text prose-chat">
										<Markdown source={entry.text} onOpenExternal={onOpenExternal} />
									</div>
								) : (
									entry.blocks.map((block) => renderBlock(block, showToolDetails, onOpenExternal))
								),
							)}
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

/** 链内的一环：思考直接铺开，工具各自保留自己的展开行。 */
function renderBlock(block: ActivityBlock, showToolDetails: boolean, onOpenExternal: (url: string) => void) {
	if (block.kind === "thinking") {
		return (
			<div key={block.key} className="turn-activity-thinking prose-chat thinking-prose">
				<Markdown source={block.text} onOpenExternal={onOpenExternal} />
			</div>
		);
	}
	return block.calls.map((call) => <ToolRow key={call.id} call={call} showDetails={showToolDetails} />);
}

/** 静态摘要：先工具后思考，数量为 0 的部分不出现。 */
function describe(entries: readonly TurnEntry[]): string {
	let tools = 0;
	let thoughts = 0;
	for (const entry of entries) {
		if (entry.kind === "text") continue;
		for (const block of entry.blocks) {
			if (block.kind === "thinking") thoughts += 1;
			else tools += block.calls.length;
		}
	}
	const parts: string[] = [];
	if (tools > 0) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
	if (thoughts > 0) parts.push(thoughts === 1 ? "thought" : `${thoughts} thoughts`);
	return parts.join(" · ");
}

/** 运行中的预览：这一轮最后在做的事。 */
function describeStep(entries: readonly TurnEntry[]): string {
	const last = entries.at(-1);
	if (!last) return "Working";
	if (last.kind === "text") return "Writing";
	const block = last.blocks.at(-1);
	if (!block) return "Working";
	if (block.kind === "thinking") return "Thinking";
	const call = block.calls.at(-1);
	return call ? call.summary : "Working";
}

/** 累计耗时只加已记录到的那部分，还在跑的工具不参与统计。 */
function totalDuration(entries: readonly TurnEntry[]): number {
	let total = 0;
	for (const entry of entries) {
		if (entry.kind === "text") continue;
		for (const block of entry.blocks) {
			if (block.kind !== "tools") continue;
			for (const call of block.calls) {
				if (call.durationMs !== null) total += call.durationMs;
			}
		}
	}
	return total;
}
