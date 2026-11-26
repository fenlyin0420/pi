// 思考等级选择浮层：列出契约里的全部等级，当前项打勾。

import type { ThinkingLevel } from "../../../shared/contract.ts";
import { IconCheck } from "../../icons.tsx";
import { cx, Popover } from "../../ui.tsx";

/** 顺序即界面顺序：从关到最大，auto 由 provider 自己决定用哪一级。 */
const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"];

const THINKING_LABELS: Record<ThinkingLevel, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
	auto: "Auto",
};

/** 等级的展示名；工具栏的等级徽章和浮层里的行共用这一份。 */
export function thinkingLevelLabel(level: ThinkingLevel): string {
	return THINKING_LABELS[level];
}

type ThinkingPickerProps = {
	/** 锚点存在即打开，为 null 时不渲染。 */
	anchor: HTMLElement | null;
	level: ThinkingLevel;
	onSelect: (level: ThinkingLevel) => void;
	onClose: () => void;
};

/** 等级浮层；选中即切换并关闭。 */
export function ThinkingPicker({ anchor, level, onSelect, onClose }: ThinkingPickerProps) {
	if (!anchor) return null;
	return (
		<Popover anchor={anchor} open onClose={onClose} align="start" width={200}>
			<div className="composer-thinking-picker" role="listbox" aria-label="Thinking level">
				{THINKING_LEVELS.map((candidate) => (
					<button
						key={candidate}
						type="button"
						role="option"
						aria-selected={candidate === level}
						className={cx("composer-plus-item", "composer-model-option", candidate === level && "active")}
						onClick={() => onSelect(candidate)}
					>
						<span className="composer-model-option-main">
							<span className="composer-model-label">{THINKING_LABELS[candidate]}</span>
						</span>
						<span className="composer-model-check-slot" aria-hidden="true">
							{candidate === level ? <IconCheck size={13} className="composer-model-check" /> : null}
						</span>
					</button>
				))}
			</div>
		</Popover>
	);
}
