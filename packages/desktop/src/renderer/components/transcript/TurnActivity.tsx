// 一轮回答的活动行：整轮的思考与工具调用折进这里，标题一行说明数量或当前在做什么。

import { useId, useState } from "react";
import { IconChevronRight, IconZap } from "../../icons.tsx";
import { formatDuration } from "../../lib/format.ts";
import { type ActivityBlock, activitySummary, type StepPreview, stepPreview } from "../../lib/turn-entries.ts";
import { cx, ShimmerText } from "../../ui.tsx";
import { Markdown } from "../Markdown.tsx";
import { ToolRow } from "./ToolRow.tsx";

type TurnActivityProps = {
	blocks: readonly ActivityBlock[];
	/** 这一轮还在跑、而这条链是最后一条：标题换成当前步骤的预览，带运行标记。 */
	running: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
};

/**
 * 一整轮的过程行。默认折叠成一行：静态时给“几个工具 · 几段思考 · 耗时”，
 * 运行中给当前这一步的预览（思考带正文最新一段、工具带调用摘要，文字走扫光）；
 * 展开后按原顺序铺开思考与工具。
 */
export function TurnActivity({ blocks, running, showToolDetails, onOpenExternal }: TurnActivityProps) {
	const [open, setOpen] = useState(false);
	const bodyId = useId();
	const duration = running ? 0 : totalDuration(blocks);
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
					{running ? <RunPreview preview={stepPreview(blocks)} /> : activitySummary(blocks)}
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

/** 运行中的预览：正文按滚动尾巴排满一行，短摘要照常左对齐。 */
function RunPreview({ preview }: { preview: StepPreview }) {
	const text = <ShimmerText text={preview.text} />;
	return preview.kind === "tail" ? <span className="tool-activity-preview">{text}</span> : text;
}

/** 累计耗时只加已记录到的那部分，还在跑的工具不参与统计。 */
function totalDuration(blocks: readonly ActivityBlock[]): number {
	let total = 0;
	for (const block of blocks) {
		if (block.kind !== "tools") continue;
		for (const call of block.calls) {
			if (call.durationMs !== null) total += call.durationMs;
		}
	}
	return total;
}
