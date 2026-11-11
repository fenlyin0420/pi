// 输入框工具栏：左侧模型与思考等级，右侧上下文占用、费用和发送/停止。

import type { AgentView } from "../../../shared/contract.ts";
import { IconArrowUp, IconChevronDown, IconStop } from "../../icons.tsx";
import { formatCost, formatTokens } from "../../lib/format.ts";
import { cx } from "../../ui.tsx";
import { thinkingLevelLabel } from "./ThinkingPicker.tsx";

type ComposerToolbarProps = {
	agent: AgentView;
	running: boolean;
	/** 有正文或附件时才能发送。 */
	canSend: boolean;
	/** 模型支持思考、且用户没有关掉思考显示时才给等级入口。 */
	showThinkingLevel: boolean;
	modelPickerOpen: boolean;
	thinkingPickerOpen: boolean;
	onOpenModelPicker: (anchor: HTMLElement) => void;
	onOpenThinkingPicker: (anchor: HTMLElement) => void;
	onSend: () => void;
	onAbort: () => void;
};

/** 工具栏；模型与等级按钮把自身当锚点，浮层因此贴着按钮展开。 */
export function ComposerToolbar({
	agent,
	running,
	canSend,
	showThinkingLevel,
	modelPickerOpen,
	thinkingPickerOpen,
	onOpenModelPicker,
	onOpenThinkingPicker,
	onSend,
	onAbort,
}: ComposerToolbarProps) {
	const usage = agent.usage;
	const contextPercent = usage?.contextWindow ? Math.round((usage.contextUsed / usage.contextWindow) * 100) : null;

	return (
		<div className="composer-toolbar">
			<div className="composer-left">
				<div className="composer-model-thinking">
					<button
						type="button"
						className={cx("icon-btn", "composer-model-thinking-chip", modelPickerOpen && "active")}
						aria-haspopup="menu"
						aria-expanded={modelPickerOpen}
						aria-label={`Model: ${agent.modelName ?? "none"}`}
						title={`Model: ${agent.modelName ?? "none"}`}
						onClick={(event) => onOpenModelPicker(event.currentTarget)}
					>
						<span className="composer-model-thinking-model">{agent.modelName ?? "No model"}</span>
						<IconChevronDown size={12} className="composer-model-thinking-chevron" aria-hidden="true" />
					</button>
				</div>
				{showThinkingLevel ? (
					<div className="composer-model-thinking">
						<button
							type="button"
							className={cx("icon-btn", "composer-model-thinking-chip", thinkingPickerOpen && "active")}
							aria-haspopup="menu"
							aria-expanded={thinkingPickerOpen}
							aria-label={`Thinking level: ${thinkingLevelLabel(agent.thinkingLevel)}`}
							title={`Thinking level: ${thinkingLevelLabel(agent.thinkingLevel)}`}
							onClick={(event) => onOpenThinkingPicker(event.currentTarget)}
						>
							<span className="composer-model-thinking-level">{thinkingLevelLabel(agent.thinkingLevel)}</span>
							<IconChevronDown size={12} className="composer-model-thinking-chevron" aria-hidden="true" />
						</button>
					</div>
				) : null}
			</div>

			<div className="composer-right">
				{usage && contextPercent !== null ? (
					<span
						className="composer-usage"
						title={`Context ${formatTokens(usage.contextUsed)} of ${formatTokens(usage.contextWindow ?? 0)} · cost ${formatCost(usage.cost)}`}
					>
						<span className="composer-usage-context">{contextPercent}%</span>
						<span className="composer-usage-tokens">
							{formatTokens(usage.contextUsed)}/{formatTokens(usage.contextWindow ?? 0)}
						</span>
						<span className="composer-usage-cost">{formatCost(usage.cost)}</span>
					</span>
				) : null}
				{running ? (
					<button type="button" className="stop-btn" aria-label="Stop" title="Stop" onClick={onAbort}>
						<IconStop size={14} aria-hidden="true" />
					</button>
				) : (
					<button
						type="button"
						className="send-btn"
						aria-label="Send"
						title={canSend ? "Send" : "Type a message first"}
						disabled={!canSend}
						onClick={onSend}
					>
						<IconArrowUp size={15} aria-hidden="true" />
					</button>
				)}
			</div>
		</div>
	);
}
