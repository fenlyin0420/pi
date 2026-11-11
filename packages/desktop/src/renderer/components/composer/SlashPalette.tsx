// 斜杠命令面板：输入 `/` 时贴在输入框上方，上下键选择、Enter 执行、Esc 关闭。

import { IconCommand } from "../../icons.tsx";
import type { SlashCommand } from "../../lib/slash-commands.ts";
import { cx } from "../../ui.tsx";

type SlashPaletteProps = {
	commands: readonly SlashCommand[];
	/** 键盘高亮行的序号。 */
	highlight: number;
	onHover: (index: number) => void;
	onRun: (command: SlashCommand) => void;
};

/** 命令列表；没有命中命令时不渲染，免得空面板盖住输入框。 */
export function SlashPalette({ commands, highlight, onHover, onRun }: SlashPaletteProps) {
	if (commands.length === 0) return null;
	return (
		<div className="composer-palette" role="listbox" aria-label="Slash commands">
			<div className="composer-ac-list">
				{commands.map((command, index) => (
					<button
						key={command.id}
						type="button"
						role="option"
						aria-selected={index === highlight}
						className={cx("composer-plus-item", "composer-ac-item", index === highlight && "kb-active")}
						// mousedown 而不是 click：焦点始终留在输入框，执行后有光标可用
						onMouseDown={(event) => {
							event.preventDefault();
							onRun(command);
						}}
						onMouseMove={() => onHover(index)}
					>
						<span className="composer-ac-icon">
							<IconCommand size={14} aria-hidden="true" />
						</span>
						<span className="composer-ac-name">{command.label}</span>
						<span className="composer-ac-desc">{command.description}</span>
					</button>
				))}
			</div>
			<div className="composer-ac-footer">
				<span>↑↓ choose</span>
				<span>Enter run</span>
				<span>Esc close</span>
			</div>
		</div>
	);
}
