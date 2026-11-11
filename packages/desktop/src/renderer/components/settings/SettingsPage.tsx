// 覆盖主区域的设置面板：外观 / Agent / 会话三块，改动立刻回写设置，没有保存按钮。

import { type ReactNode, useEffect, useRef } from "react";
import type { AgentView, DesktopSettings, ResolvedTheme, ThinkingLevel } from "../../../shared/contract.ts";
import { IconClose } from "../../icons.tsx";
import { cx, IconButton, Segmented, Switch } from "../../ui.tsx";

const THEME_OPTIONS: readonly { value: DesktopSettings["theme"]; label: string }[] = [
	{ value: "system", label: "System" },
	{ value: "dark", label: "Dark" },
	{ value: "light", label: "Light" },
];

const DENSITY_OPTIONS: readonly { value: DesktopSettings["density"]; label: string }[] = [
	{ value: "comfortable", label: "Comfortable" },
	{ value: "compact", label: "Compact" },
];

// 字号缩放的取值区间由 main 侧持久化时同样校验，这里保持一致。
const MIN_FONT_SCALE = 0.85;
const MAX_FONT_SCALE = 1.4;
const FONT_SCALE_STEP = 0.05;

/** 渲染设置面板；关闭或状态还没到时什么都不画。 */
export function SettingsPage({
	open,
	settings,
	agent,
	theme,
	cwd,
	sessionCount,
	onUpdate,
	onClose,
}: {
	open: boolean;
	settings: DesktopSettings | undefined;
	agent: AgentView | null;
	theme: ResolvedTheme;
	/** 当前会话的工作目录与会话总数；由 App 传入，缺省时对应行显示占位符。 */
	cwd?: string;
	sessionCount?: number;
	onUpdate: (patch: Partial<DesktopSettings>) => void;
	onClose: () => void;
}) {
	const panelRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	// 面板自己接住焦点，键盘用户不必先 Tab 过整个界面才能操作设置。
	useEffect(() => {
		if (open) panelRef.current?.focus();
	}, [open]);

	if (!open || !settings) return null;

	const percent = Math.round(settings.fontScale * 100);

	return (
		<div className="settings-page" role="dialog" aria-label="Settings" tabIndex={-1} ref={panelRef}>
			<header className="settings-page-header">
				<div className="settings-page-heading">
					<h2 className="settings-page-title">Settings</h2>
					<p className="settings-page-subtitle">Changes apply immediately.</p>
				</div>
				<IconButton label="Close settings" className="settings-close" onClick={onClose}>
					<IconClose size={16} />
				</IconButton>
			</header>
			<div className="settings-page-body">
				<section className="settings-card-block" aria-labelledby="settings-appearance">
					<h3 className="settings-card-heading" id="settings-appearance">
						Appearance
					</h3>
					<div className="settings-panel">
						<SettingsRow title="Theme" detail={`Resolved appearance: ${theme}`}>
							<Segmented
								ariaLabel="Theme"
								value={settings.theme}
								options={THEME_OPTIONS}
								onChange={(value) => onUpdate({ theme: value })}
							/>
						</SettingsRow>
						<SettingsRow title="Font scale">
							<div className="settings-font-size">
								<input
									type="range"
									min={MIN_FONT_SCALE}
									max={MAX_FONT_SCALE}
									step={FONT_SCALE_STEP}
									value={settings.fontScale}
									aria-label="Font scale"
									aria-valuetext={`${percent}%`}
									onChange={(event) => onUpdate({ fontScale: Number(event.target.value) })}
								/>
								<span className="settings-font-size-percent">{percent}%</span>
							</div>
						</SettingsRow>
						<SettingsRow title="Density">
							<Segmented
								ariaLabel="Density"
								value={settings.density}
								options={DENSITY_OPTIONS}
								onChange={(value) => onUpdate({ density: value })}
							/>
						</SettingsRow>
						<SettingsRow title="Show thinking">
							<Switch
								label="Show thinking"
								checked={settings.showThinking}
								onChange={(checked) => onUpdate({ showThinking: checked })}
							/>
						</SettingsRow>
						<SettingsRow title="Show tool details">
							<Switch
								label="Show tool details"
								checked={settings.showToolDetails}
								onChange={(checked) => onUpdate({ showToolDetails: checked })}
							/>
						</SettingsRow>
						<SettingsRow title="Show usage">
							<Switch
								label="Show usage"
								checked={settings.showUsage}
								onChange={(checked) => onUpdate({ showUsage: checked })}
							/>
						</SettingsRow>
					</div>
				</section>

				<section className="settings-card-block" aria-labelledby="settings-agent">
					<h3 className="settings-card-heading" id="settings-agent">
						Agent
					</h3>
					<div className="settings-panel">
						<SettingsRow title="Model" detail="Selected in the composer">
							<span className="settings-value">{agent?.modelName ?? agent?.model ?? "None"}</span>
						</SettingsRow>
						<SettingsRow title="Thinking level">
							<span className="settings-value">{agent ? thinkingLabel(agent.thinkingLevel) : "—"}</span>
						</SettingsRow>
						<SettingsRow title="Status">
							<span
								className={cx("settings-value", "settings-status", agent?.status === "running" && "is-running")}
							>
								<span className="settings-status-dot" aria-hidden="true" />
								{agent?.status === "running" ? "Running" : "Idle"}
							</span>
						</SettingsRow>
					</div>
				</section>

				<section className="settings-card-block" aria-labelledby="settings-session">
					<h3 className="settings-card-heading" id="settings-session">
						Session
					</h3>
					<div className="settings-panel">
						<SettingsRow title="Working directory">
							<span className="settings-value settings-value-path" title={cwd}>
								{cwd ?? "—"}
							</span>
						</SettingsRow>
						<SettingsRow title="Sessions">
							<span className="settings-value">{sessionCount ?? "—"}</span>
						</SettingsRow>
					</div>
				</section>
			</div>
		</div>
	);
}

/** 一行设置：左侧标题与说明，右侧控件。 */
function SettingsRow({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
	return (
		<div className="settings-row">
			<div className="settings-row-copy">
				<span className="settings-row-title">{title}</span>
				{detail ? <span className="settings-row-detail">{detail}</span> : null}
			</div>
			<div className="settings-row-control">{children}</div>
		</div>
	);
}

/** 思考等级在面板里按句子大小写显示，与 composer 的原始枚举值区分开。 */
function thinkingLabel(level: ThinkingLevel): string {
	return level === "xhigh" ? "Extra high" : level.charAt(0).toUpperCase() + level.slice(1);
}
