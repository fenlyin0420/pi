// 无边框窗口的标题栏：整条是拖动区，左侧折叠侧栏，中间标题与运行状态，右侧搜索/设置。
// 最小化/最大化/关闭由系统的窗口按钮画（Window Controls Overlay），这里不再自绘。

import type { AgentStatus, Platform } from "../../shared/contract.ts";
import { IconPanelLeftClose, IconPanelLeftOpen, IconSearch, IconSettings } from "../icons.tsx";
import { cx, IconButton } from "../ui.tsx";

/** 渲染标题栏。 */
export function Titlebar({
	platform,
	sessionTitle,
	status,
	sidebarCollapsed,
	onToggleSidebar,
	onSearch,
	onOpenSettings,
}: {
	platform: Platform;
	sessionTitle: string;
	status: AgentStatus;
	sidebarCollapsed: boolean;
	onToggleSidebar: () => void;
	onSearch: () => void;
	onOpenSettings: () => void;
}) {
	const running = status === "running";
	// 快捷键标签跟着平台走：macOS 用 ⌘，其余平台用 Ctrl。
	const modKey = platform === "darwin" ? "⌘" : "Ctrl+";

	return (
		<div className="conversation-topbar" role="toolbar" aria-label="Session">
			<div className="ct-left">
				<IconButton
					label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
					size="small"
					className="ct-icon-btn"
					onClick={onToggleSidebar}
				>
					{sidebarCollapsed ? <IconPanelLeftOpen size={15} /> : <IconPanelLeftClose size={15} />}
				</IconButton>
				<div className="ct-title-wrap" title={sessionTitle}>
					<h1 className="ct-title">{sessionTitle}</h1>
					<span
						className={cx("ct-status", running && "is-running")}
						role="img"
						aria-label={running ? "Agent is running" : "Agent is idle"}
						title={running ? "Agent is running" : "Agent is idle"}
					/>
				</div>
			</div>
			<div className="ct-right">
				<div className="ct-actions">
					<IconButton label={`Search (${modKey}K)`} size="small" className="ct-icon-btn" onClick={onSearch}>
						<IconSearch size={15} />
					</IconButton>
					<IconButton
						label={`Settings (${modKey},)`}
						size="small"
						className="ct-icon-btn"
						onClick={onOpenSettings}
					>
						<IconSettings size={15} />
					</IconButton>
				</div>
			</div>
		</div>
	);
}
