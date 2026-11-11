// 一轮回答结束后的用量行：耗时、token 数、费用、模型名。

import type { TurnUsage } from "../../../shared/contract.ts";
import { formatCost, formatDuration, formatTokens } from "../../lib/format.ts";

/** 显示本轮耗时/token/费用/模型；四者都缺时不渲染。 */
export function TurnMeta({ usage, model }: { usage: TurnUsage | null; model: string | null }) {
	const duration = usage ? formatDuration(usage.durationMs) : "";
	const hasUsage = usage !== null && (usage.input > 0 || usage.output > 0 || usage.cost > 0);
	if (!duration && !hasUsage && !model) return null;
	return (
		<div className="message-meta">
			{duration ? <span className="message-meta-chip">{duration}</span> : null}
			{usage ? (
				<span className="message-meta-chip">
					{`${formatTokens(usage.input)} in · ${formatTokens(usage.output)} out`}
				</span>
			) : null}
			{usage && usage.cost > 0 ? <span className="message-meta-chip">{formatCost(usage.cost)}</span> : null}
			{model ? (
				<span className="message-meta-chip model" title={model}>
					{model}
				</span>
			) : null}
		</div>
	);
}
