// 应用外壳：主题注入、快捷键、菜单动作分发，以及侧栏/对话/设置三块区域的装配。

import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopSettings, MenuAction } from "../shared/contract.ts";
import { AskDialog } from "./components/AskDialog.tsx";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette.tsx";
import { Composer } from "./components/composer/Composer.tsx";
import { DiffPanel } from "./components/diff/DiffPanel.tsx";
import { SettingsPage } from "./components/settings/SettingsPage.tsx";
import { Sidebar } from "./components/sidebar/Sidebar.tsx";
import { Titlebar } from "./components/Titlebar.tsx";
import { ToastHost } from "./components/ToastHost.tsx";
import { Transcript } from "./components/transcript/Transcript.tsx";
import type { TurnFileChange } from "./lib/turn-changes.ts";
import { useDesktop } from "./store.ts";
import { ThemeContext } from "./ui.tsx";

/** 渲染桌面窗口。 */
export function App() {
	const { state, send, dismissToast } = useDesktop();
	const desktop = state.desktop;
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	/** 右栏打开的 diff：点轮末卡片时把那一轮的文件和选中的文件一起放进来。 */
	const [diff, setDiff] = useState<{
		sessionId: string | null;
		files: readonly TurnFileChange[];
		path: string;
	} | null>(null);

	const theme = desktop?.theme ?? "dark";
	const settings = desktop?.settings;

	// 主题、平台、字号、密度都是根节点的 data 属性 / CSS 变量，组件只消费 token。
	useEffect(() => {
		const root = document.documentElement;
		root.dataset.theme = theme;
		root.dataset.platform = desktop?.platform ?? "linux";
		root.dataset.density = settings?.density ?? "comfortable";
		root.style.setProperty("--font-scale", String(settings?.fontScale ?? 1));
	}, [theme, desktop?.platform, settings?.density, settings?.fontScale]);

	const updateSettings = useCallback(
		(patch: Partial<DesktopSettings>) => send({ type: "updateSettings", patch }),
		[send],
	);

	const runMenuAction = useCallback(
		(action: MenuAction) => {
			switch (action) {
				case "newSession":
					send({ type: "newSession" });
					return;
				case "addWorkspace":
					send({ type: "addWorkspace" });
					return;
				case "settings":
					setSettingsOpen(true);
					return;
				case "search":
					setPaletteOpen(true);
					return;
				case "toggleSidebar":
					if (settings) updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed });
					return;
				case "closeSession":
					setPaletteOpen(false);
					return;
			}
		},
		[send, settings, updateSettings],
	);

	// 原生菜单只在 seq 变化时消费一次：同一动作连点两次也要各执行一次，重渲染则不能重复执行。
	const consumedMenuSeq = useRef<number | null>(null);
	useEffect(() => {
		const menu = state.menu;
		if (!menu || menu.seq === consumedMenuSeq.current) return;
		consumedMenuSeq.current = menu.seq;
		runMenuAction(menu.action);
	}, [state.menu, runMenuAction]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const meta = event.metaKey || event.ctrlKey;
			if (!meta) {
				if (event.key === "Escape") {
					setPaletteOpen(false);
					setDiff(null);
				}
				return;
			}
			switch (event.key.toLowerCase()) {
				case "k":
					event.preventDefault();
					setPaletteOpen((open) => !open);
					return;
				case "n":
					event.preventDefault();
					send({ type: "newSession" });
					return;
				case "o":
					event.preventDefault();
					send({ type: "addWorkspace" });
					return;
				case "b":
					event.preventDefault();
					if (settings) updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed });
					return;
				case ",":
					event.preventDefault();
					setSettingsOpen(true);
					return;
				default:
					return;
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [send, settings, updateSettings]);

	const activeSession = desktop?.sessions.find((session) => session.id === desktop.activeSessionId) ?? null;
	const collapsed = settings?.sidebarCollapsed ?? false;
	const running = desktop?.agent.status === "running";

	// 换会话就把右栏收起来：面板里的文件和路径都属于上一个会话。
	const activeSessionId = desktop?.activeSessionId ?? null;
	const shownDiff = diff !== null && diff.sessionId === activeSessionId ? diff : null;

	return (
		<ThemeContext.Provider value={theme}>
			<div
				className="app-shell"
				data-sidebar-collapsed={collapsed || undefined}
				data-maximized={state.maximized || undefined}
			>
				{desktop && settings ? (
					<>
						<Sidebar
							state={desktop}
							collapsed={collapsed}
							onOpenSession={(id) => send({ type: "openSession", id })}
							onNewSession={() => send({ type: "newSession" })}
							onNewSessionIn={(path) => send({ type: "newSession", workspace: path })}
							onAddWorkspace={() => send({ type: "addWorkspace" })}
							onRenameSession={(id, title) => send({ type: "renameSession", id, title })}
							onDeleteSession={(id) => send({ type: "deleteSession", id })}
							onPinSession={(id, pinned) => send({ type: "pinSession", id, pinned })}
							onOpenSettings={() => setSettingsOpen(true)}
							onToggleTheme={() =>
								updateSettings({
									theme:
										settings.theme === "system"
											? theme === "dark"
												? "light"
												: "dark"
											: settings.theme === "dark"
												? "light"
												: "dark",
								})
							}
							onSearch={() => setPaletteOpen(true)}
							onResize={(width) => updateSettings({ sidebarWidth: width })}
						/>
						<div className="main-pane">
							<Titlebar
								platform={desktop.platform}
								sessionTitle={
									activeSession?.title ??
									desktop.workspaces.find((entry) => entry.path === desktop.workspace)?.name ??
									"pi"
								}
								status={desktop.agent.status}
								sidebarCollapsed={collapsed}
								onToggleSidebar={() => updateSettings({ sidebarCollapsed: !collapsed })}
								onSearch={() => setPaletteOpen(true)}
								onOpenSettings={() => setSettingsOpen(true)}
							/>
							<div className="main-body">
								<div className="main-column">
									<Transcript
										items={desktop.transcript}
										sessionId={desktop.activeSessionId}
										workspace={desktop.workspace}
										onAddWorkspace={() => send({ type: "addWorkspace" })}
										status={desktop.agent.status}
										activity={desktop.agent.activity}
										queued={desktop.agent.queued.steering}
										onWithdraw={() => send({ type: "withdrawQueue" })}
										showThinking={settings.showThinking}
										showUsage={settings.showUsage}
										showToolDetails={settings.showToolDetails}
										onOpenExternal={(url) => send({ type: "openExternal", url })}
										onOpenChanges={(files, path) => setDiff({ sessionId: activeSessionId, files, path })}
										onPrompt={(text) => send({ type: "prompt", text })}
									/>
									<Composer
										sessionId={desktop.activeSessionId}
										workspace={desktop.workspace}
										workspaces={desktop.workspaces}
										platform={desktop.platform}
										agent={desktop.agent}
										models={state.models}
										thinking={settings.showThinking}
										sessionRestore={state.draftRestore}
										onWithdrawQueue={() => send({ type: "withdrawQueue" })}
										attach={window.piDesktop}
										onSend={(text, attachments) => send({ type: "prompt", text, attachments })}
										onSteer={(text) => send({ type: "steer", text })}
										onAbort={() => send({ type: "abort" })}
										onSetModel={(model) => send({ type: "setModel", model })}
										onSetThinkingLevel={(level) => send({ type: "setThinkingLevel", level })}
										onRequestModels={() => send({ type: "listModels" })}
										onOpenSettings={() => setSettingsOpen(true)}
										onNewSession={() => send({ type: "newSession" })}
										onSelectWorkspace={(path) => send({ type: "selectWorkspace", path })}
										onAddWorkspace={() => send({ type: "addWorkspace" })}
									/>
								</div>
								{shownDiff !== null ? (
									<DiffPanel
										files={shownDiff.files}
										selected={shownDiff.path}
										width={settings.diffPanelWidth}
										onSelect={(path) => setDiff({ ...shownDiff, path })}
										onResize={(width) => updateSettings({ diffPanelWidth: width })}
										onClose={() => setDiff(null)}
									/>
								) : null}
							</div>
						</div>
					</>
				) : (
					<div className="app-loading">
						<span className="spinner" />
					</div>
				)}

				<SettingsPage
					open={settingsOpen}
					settings={settings}
					agent={desktop?.agent ?? null}
					theme={theme}
					cwd={desktop?.workspace ?? undefined}
					sessionCount={desktop?.sessions.length}
					onUpdate={updateSettings}
					onClose={() => setSettingsOpen(false)}
				/>
				<CommandPalette
					open={paletteOpen}
					sessions={desktop?.sessions ?? []}
					workspaces={desktop?.workspaces ?? []}
					onClose={() => setPaletteOpen(false)}
					onOpenSession={(id) => {
						setPaletteOpen(false);
						send({ type: "openSession", id });
					}}
					onAction={(action: PaletteAction) => {
						setPaletteOpen(false);
						runMenuAction(action);
					}}
				/>
				<ToastHost toasts={state.toasts} onDismiss={dismissToast} />
				{/* 每次提问一份独立草稿：flowId 一变就重挂。 */}
				<AskDialog
					key={state.ask?.flowId ?? "none"}
					request={state.ask}
					onSubmit={(flowId, answers, note) => send({ type: "askAnswer", flowId, answers, note })}
				/>
				{running ? <output className="sr-only">Agent is running</output> : null}
			</div>
		</ThemeContext.Provider>
	);
}
