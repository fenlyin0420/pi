// 一轮回答的活动行：整轮的思考与工具调用折进这里，标题一行只报数量，跑着时下面多一行预览。

import { useId, useState } from "react";
import { IconChevronRight, IconZap } from "../../icons.tsx";
import { formatDuration } from "../../lib/format.ts";
import { type ActivityBlock, activitySummary, type StepPreview, stepPreview } from "../../lib/turn-entries.ts";
import { cx, ShimmerText } from "../../ui.tsx";
import { ThinkingFold } from "./ThinkingFold.tsx";
import { ToolRow } from "./ToolRow.tsx";

type TurnActivityProps = {
	blocks: readonly ActivityBlock[];
	/** 这一轮还在跑、而这条链是最后一条：标题多一个运行标记，下面多一行预览。 */
	running: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
};

/**
 * 一整轮的过程行。折叠时只占一行标题，报数量：先工具后思考，结束后再带耗时；
 * 运行中标题下面多一行，预览当前这一步（思考带正文最新一段、工具带调用摘要，文字走扫光）。
 * 展开后按原顺序铺开思考与工具。
 */
export function TurnActivity({ blocks, running, showToolDetails, onOpenExternal }: TurnActivityProps) {
	const [open, setOpen] = useState(false);
	const bodyId = useId();
	const duration = running ? 0 : totalDuration(blocks);
	return (
		<div className={cx("tool-activity-group", "turn-activity", open && "open")}>
			{/* 吸顶的是一层整行走廊，标题按钮本身只有内容宽：见 .turn-activity-head。 */}
			<div className="turn-activity-head">
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
					<span className="tool-activity-label">{activitySummary(blocks)}</span>
					{running ? <span className="activity-marker" aria-hidden /> : null}
					{duration > 0 ? <span className="tool-activity-count">{`· ${formatDuration(duration)}`}</span> : null}
					<span className="tool-activity-caret" aria-hidden>
						<IconChevronRight size={12} />
					</span>
				</button>
			</div>
			{running ? <RunPreview preview={stepPreview(blocks.at(-1) ?? null)} /> : null}
			{open ? (
				<div className="tool-activity-collapse">
					<div className="tool-activity-collapse-inner">
						<div className="tool-activity-body turn-activity-body" id={bodyId}>
							{blocks.map((block) =>
								block.kind === "thinking" ? (
									<ThinkingFold key={block.key} text={block.text} onOpenExternal={onOpenExternal} />
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

/** 运行中的预览：思考的尾巴靠右排满一行，短摘要照常左对齐。 */
function RunPreview({ preview }: { preview: StepPreview }) {
	return (
		<div className={cx("turn-activity-preview", preview.kind)}>
			<ShimmerText text={preview.text} />
		</div>
	);
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
