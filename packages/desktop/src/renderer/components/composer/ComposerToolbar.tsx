// 输入框工具栏：左侧模型与思考等级，右侧上下文占用、费用和发送/停止。

import type { AgentView } from "../../../shared/contract.ts";
import { IconArrowUp, IconChevronDown, IconPaperclip, IconSparkles, IconStop } from "../../icons.tsx";
import { formatCost, formatTokens } from "../../lib/format.ts";
import { cx } from "../../ui.tsx";
import { thinkingLevelLabel } from "./ThinkingPicker.tsx";

type ComposerToolbarProps = {
	agent: AgentView;
	running: boolean;
	/** 没选中 workspace 时整条工具栏都没得用。 */
	locked: boolean;
	/** 有正文或附件时才能发送。 */
	canSend: boolean;
	/** 附件未到上限时才能再挑：到上限后回形针禁用。 */
	canAttach: boolean;
	/** 模型支持思考、且用户没有关掉思考显示时才给等级入口。 */
	showThinkingLevel: boolean;
	/** 这个会话开着沉浸模式：主栏是 HTML 舞台而不是对话区。 */
	immersive: boolean;
	onToggleImmersive: () => void;
	modelPickerOpen: boolean;
	thinkingPickerOpen: boolean;
	onAttachFiles: () => void;
	onOpenModelPicker: (anchor: HTMLElement) => void;
	onOpenThinkingPicker: (anchor: HTMLElement) => void;
	onSend: () => void;
	onAbort: () => void;
};

/** 工具栏；模型与等级按钮把自身当锚点，浮层因此贴着按钮展开。 */
export function ComposerToolbar({
	agent,
	running,
	locked,
	canSend,
	canAttach,
	showThinkingLevel,
	immersive,
	onToggleImmersive,
	modelPickerOpen,
	thinkingPickerOpen,
	onAttachFiles,
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
				<button
					type="button"
					className="icon-btn composer-attach-btn"
					aria-label="Attach files"
					title={locked ? "Select a workspace first" : canAttach ? "Attach files" : "Attachment limit reached"}
					disabled={locked || !canAttach}
					onClick={onAttachFiles}
				>
					<IconPaperclip size={14} aria-hidden="true" />
				</button>
				<div className="composer-model-thinking">
					<button
						type="button"
						className={cx("icon-btn", "composer-model-thinking-chip", modelPickerOpen && "active")}
						aria-haspopup="menu"
						aria-expanded={modelPickerOpen}
						aria-label={`Model: ${agent.modelName ?? "none"}`}
						title={`Model: ${agent.modelName ?? "none"}`}
						disabled={locked}
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
							disabled={locked}
							onClick={(event) => onOpenThinkingPicker(event.currentTarget)}
						>
							<span className="composer-model-thinking-level">{thinkingLevelLabel(agent.thinkingLevel)}</span>
							<IconChevronDown size={12} className="composer-model-thinking-chevron" aria-hidden="true" />
						</button>
					</div>
				) : null}
			</div>

			<div className="composer-right">
				<button
					type="button"
					className={cx("icon-btn", "composer-immersive-btn", immersive && "active")}
					aria-pressed={immersive}
					aria-label="Immersive mode"
					title={immersive ? "Leave immersive mode" : "Immersive mode: the model renders an interactive page"}
					onClick={onToggleImmersive}
				>
					<IconSparkles size={14} aria-hidden="true" />
				</button>
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
						title={locked ? "Select a workspace first" : canSend ? "Send" : "Type a message first"}
						disabled={locked || !canSend}
						onClick={onSend}
					>
						<IconArrowUp size={15} aria-hidden="true" />
					</button>
				)}
			</div>
		</div>
	);
}
