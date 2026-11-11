// 应用外壳：主题注入、快捷键、菜单动作分发，以及侧栏/对话/设置三块区域的装配。

import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopSettings, MenuAction } from "../shared/contract.ts";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette.tsx";
import { Composer } from "./components/composer/Composer.tsx";
import { SettingsPage } from "./components/settings/SettingsPage.tsx";
import { Sidebar } from "./components/sidebar/Sidebar.tsx";
import { Titlebar } from "./components/Titlebar.tsx";
import { ToastHost } from "./components/ToastHost.tsx";
import { Transcript } from "./components/transcript/Transcript.tsx";
import { useDesktop } from "./store.ts";
import { ThemeContext } from "./ui.tsx";

/** 渲染桌面窗口。 */
export function App() {
	const { state, send, dismissToast } = useDesktop();
	const desktop = state.desktop;
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);

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
				case "openProject":
					send({ type: "openProject" });
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
				if (event.key === "Escape") setPaletteOpen(false);
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
					send({ type: "openProject" });
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

	return (
		<ThemeContext.Provider value={theme}>
			<div className="app-shell" data-sidebar-collapsed={collapsed || undefined}>
				{desktop && settings ? (
					<>
						<Sidebar
							state={desktop}
							collapsed={collapsed}
							onOpenSession={(id) => send({ type: "openSession", id })}
							onNewSession={() => send({ type: "newSession" })}
							onOpenProject={() => send({ type: "openProject" })}
							onOpenRecentProject={(path) => send({ type: "openRecentProject", path })}
							onRenameSession={(id, title) => send({ type: "renameSession", id, title })}
							onDeleteSession={(id) => send({ type: "deleteSession", id })}
							onPinSession={(id, pinned) => send({ type: "pinSession", id, pinned })}
							onOpenSettings={() => setSettingsOpen(true)}
							onToggleCollapsed={() => updateSettings({ sidebarCollapsed: !collapsed })}
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
								sessionTitle={activeSession?.title ?? "pi"}
								modelName={desktop.agent.modelName}
								status={desktop.agent.status}
								maximized={state.maximized}
								sidebarCollapsed={collapsed}
								onToggleSidebar={() => updateSettings({ sidebarCollapsed: !collapsed })}
								onSearch={() => setPaletteOpen(true)}
								onOpenSettings={() => setSettingsOpen(true)}
								onMinimize={() => send({ type: "windowControl", action: "minimize" })}
								onMaximize={() => send({ type: "windowControl", action: "maximize" })}
								onClose={() => send({ type: "windowControl", action: "close" })}
							/>
							<Transcript
								items={desktop.transcript}
								sessionId={desktop.activeSessionId}
								cwd={desktop.cwd}
								status={desktop.agent.status}
								showThinking={settings.showThinking}
								showUsage={settings.showUsage}
								showToolDetails={settings.showToolDetails}
								onOpenExternal={(url) => send({ type: "openExternal", url })}
								onPrompt={(text) => send({ type: "prompt", text })}
							/>
							<Composer
								sessionId={desktop.activeSessionId}
								agent={desktop.agent}
								models={state.models}
								thinking={settings.showThinking}
								onSend={(text, images) => send({ type: "prompt", text, images })}
								onSteer={(text) => send({ type: "steer", text })}
								onAbort={() => send({ type: "abort" })}
								onSetModel={(model) => send({ type: "setModel", model })}
								onSetThinkingLevel={(level) => send({ type: "setThinkingLevel", level })}
								onRequestModels={() => send({ type: "listModels" })}
								onOpenSettings={() => setSettingsOpen(true)}
								onNewSession={() => send({ type: "newSession" })}
							/>
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
					cwd={desktop?.cwd}
					sessionCount={desktop?.sessions.length}
					onUpdate={updateSettings}
					onClose={() => setSettingsOpen(false)}
				/>
				<CommandPalette
					open={paletteOpen}
					sessions={desktop?.sessions ?? []}
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
				{running ? <output className="sr-only">Agent is running</output> : null}
			</div>
		</ThemeContext.Provider>
	);
}
