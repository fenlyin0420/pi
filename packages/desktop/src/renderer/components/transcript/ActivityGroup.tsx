// 连续工具调用的分组：一行标题（数量 + 累计耗时），展开后是组内每个 ToolRow。

import { useId, useState } from "react";
import type { ToolCallView } from "../../../shared/contract.ts";
import { IconChevronRight, IconZap } from "../../icons.tsx";
import { formatDuration } from "../../lib/format.ts";
import { cx } from "../../ui.tsx";
import { ToolRow } from "./ToolRow.tsx";

type ActivityGroupProps = {
	calls: readonly ToolCallView[];
	showDetails: boolean;
};

/** 一组相邻的工具调用；调用方只在有两个以上调用时才用分组。 */
export function ActivityGroup({ calls, showDetails }: ActivityGroupProps) {
	// null 表示沿用偏好；点过标题后以自己的选择为准。
	const [choice, setChoice] = useState<boolean | null>(null);
	const detailsId = useId();
	const open = choice ?? showDetails;
	const running = calls.some((call) => call.state === "running");
	const duration = formatDuration(totalDuration(calls));
	return (
		<div className={cx("tool-activity-group", open && "open", running && "active")}>
			<button
				type="button"
				className="tool-activity-header"
				aria-expanded={open}
				aria-controls={detailsId}
				onClick={() => setChoice(!open)}
			>
				<span className="tool-activity-icon" aria-hidden>
					<IconZap size={14} />
				</span>
				<span className={cx("tool-activity-label", running && "running")}>{`${calls.length} tools`}</span>
				{running ? <span className="activity-marker" aria-hidden /> : null}
				{duration ? <span className="tool-activity-count">{`· ${duration}`}</span> : null}
				<span className="tool-activity-caret" aria-hidden>
					<IconChevronRight size={12} />
				</span>
			</button>
			{open ? (
				<div className="tool-activity-collapse">
					<div className="tool-activity-collapse-inner">
						<div className="tool-activity-body" id={detailsId}>
							{calls.map((call) => (
								<ToolRow key={call.id} call={call} showDetails={showDetails} />
							))}
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

/** 累计耗时只加已记录到的那部分，还在跑的工具不参与统计。 */
function totalDuration(calls: readonly ToolCallView[]): number | null {
	let total = 0;
	for (const call of calls) {
		if (call.durationMs !== null) total += call.durationMs;
	}
	return total > 0 ? total : null;
}
