// 应用外壳：主题注入、快捷键、菜单动作分发，以及侧栏/对话/设置三块区域的装配。

import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopSettings, MenuAction } from "../shared/contract.ts";
import { ArtifactStage } from "./components/artifact/ArtifactStage.tsx";
import { AskDock } from "./components/ask/AskDock.tsx";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette.tsx";
import { Composer } from "./components/composer/Composer.tsx";
import { DiffPanel } from "./components/diff/DiffPanel.tsx";
import { IssueStrip } from "./components/issues/IssueStrip.tsx";
import { IssuesPage } from "./components/issues/IssuesPage.tsx";
import { SettingsPage } from "./components/settings/SettingsPage.tsx";
import { Sidebar } from "./components/sidebar/Sidebar.tsx";
import { Titlebar } from "./components/Titlebar.tsx";
import { ToastHost } from "./components/ToastHost.tsx";
import { TodoDock } from "./components/todo/TodoDock.tsx";
import { Transcript } from "./components/transcript/Transcript.tsx";
import { issuesOf } from "./lib/issues.ts";
import type { TurnFileChange } from "./lib/turn-changes.ts";
import { useDesktop } from "./store.ts";
import { ThemeContext } from "./ui.tsx";

/** 渲染桌面窗口。 */
export function App() {
	const { state, send, dismissToast } = useDesktop();
	const desktop = state.desktop;
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	/** issue 动作区是主栏的另一个 surface：开着时对话区让位，侧栏和标题栏不动。 */
	const [issuesOpen, setIssuesOpen] = useState(false);
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

	/**
	 * 回到对话：点会话、开新会话、从 issue 跳到它的线程都算，issue 面一律让位。
	 * 不能在 activeSessionId 变化时收 issue 面：从会话 A 打开 issue 面后 A 仍是当前会话，
	 * 再点 A 不会发出新 id，也就没有状态变化，那样点会话永远回不了对话。
	 */
	const showConversation = useCallback(() => setIssuesOpen(false), []);

	const activeSessionId = desktop?.activeSessionId ?? null;
	const immersive = activeSessionId !== null && (settings?.immersiveSessions.includes(activeSessionId) ?? false);
	// 模式粒度是会话：切换只写这个会话的设置，不动别人正在看的对话。
	const toggleImmersive = useCallback(() => {
		if (activeSessionId === null) return;
		send({ type: "setImmersive", sessionId: activeSessionId, immersive: !immersive });
	}, [activeSessionId, immersive, send]);

	const runMenuAction = useCallback(
		(action: MenuAction | PaletteAction) => {
			switch (action) {
				case "newSession":
					showConversation();
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
				case "issues":
					setIssuesOpen(true);
					return;
				case "immersive":
					showConversation();
					toggleImmersive();
					return;
			}
		},
		[send, settings, updateSettings, showConversation, toggleImmersive],
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
					setIssuesOpen(false);
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
					showConversation();
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
				case "i":
					// 只在带 Shift 时才占这个组合键，免得抢别的习惯用法。
					if (!event.shiftKey) return;
					event.preventDefault();
					setIssuesOpen((open) => !open);
					return;
				case "m":
					if (!event.shiftKey) return;
					event.preventDefault();
					showConversation();
					toggleImmersive();
					return;
				default:
					return;
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [send, settings, updateSettings, showConversation, toggleImmersive]);

	const activeSession = desktop?.sessions.find((session) => session.id === desktop.activeSessionId) ?? null;
	const collapsed = settings?.sidebarCollapsed ?? false;
	const running = desktop?.agent.status === "running";

	// 换会话就把右栏收起来：面板里的文件和路径都属于上一个会话。
	const shownDiff = diff !== null && diff.sessionId === activeSessionId ? diff : null;
	// issue 区的开关是主栏的 surface 切换，侧栏与标题栏不动。
	const scopedIssues = desktop ? issuesOf(desktop.issues, desktop.workspace, desktop.platform) : [];
	const threadIssue = scopedIssues.find((issue) => issue.sessionId === activeSessionId) ?? null;

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
							onOpenSession={(id) => {
								showConversation();
								send({ type: "openSession", id });
							}}
							onNewSession={() => {
								showConversation();
								send({ type: "newSession" });
							}}
							onNewSessionIn={(path) => {
								showConversation();
								send({ type: "newSession", workspace: path });
							}}
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
								maximized={state.maximized}
								sidebarCollapsed={collapsed}
								issuesOpen={issuesOpen}
								onToggleIssues={() => setIssuesOpen((open) => !open)}
								onToggleSidebar={() => updateSettings({ sidebarCollapsed: !collapsed })}
								onSearch={() => setPaletteOpen(true)}
								onOpenSettings={() => setSettingsOpen(true)}
								onMinimize={() => send({ type: "windowControl", action: "minimize" })}
								onMaximize={() => send({ type: "windowControl", action: "maximize" })}
								onClose={() => send({ type: "windowControl", action: "close" })}
							/>
							<div className="main-body">
								{issuesOpen ? (
									<IssuesPage
										issues={desktop.issues}
										run={desktop.issueRun}
										workspace={desktop.workspace}
										platform={desktop.platform}
										detail={state.issueDetail}
										onClose={() => setIssuesOpen(false)}
										onSelect={(id) => send({ type: "selectIssue", id })}
										onCreate={(title, body) => send({ type: "createIssue", title, body })}
										onUpdate={(id, patch) => send({ type: "updateIssue", id, ...patch })}
										onComment={(id, text) => send({ type: "commentIssue", id, text })}
										onDelete={(id) => send({ type: "deleteIssue", id })}
										onStatus={(action, id) =>
											send(action === "close" ? { type: "closeIssue", id } : { type: "reopenIssue", id })
										}
										onSetQueue={(ids, queued) => send({ type: "setIssueQueue", ids, queued })}
										onOpenThread={(id) => {
											showConversation();
											send({ type: "openIssueThread", id });
										}}
										onRun={(action) => send({ type: "runIssues", action })}
										onOpenExternal={(url) => send({ type: "openExternal", url })}
									/>
								) : (
									<>
										<div className="main-column">
											{threadIssue ? (
												<IssueStrip issue={threadIssue} onOpen={() => setIssuesOpen(true)} />
											) : null}
											{immersive && activeSessionId !== null ? (
												<ArtifactStage
													// 舞台按会话重挂：轮次选择、源码视图、全屏都不该跨会话残留。
													key={activeSessionId}
													sessionId={activeSessionId}
													title={activeSession?.title ?? "pi"}
													items={desktop.transcript}
													theme={theme}
													status={desktop.agent.status}
													onSubmit={(text) => send({ type: "prompt", text })}
													onSteer={(text) => send({ type: "steer", text })}
													onAbort={() => send({ type: "abort" })}
													onOpenExternal={(url) => send({ type: "openExternal", url })}
													onExit={toggleImmersive}
												/>
											) : (
												<Transcript
													items={desktop.transcript}
													sessionId={activeSessionId}
													workspace={desktop.workspace}
													onAddWorkspace={() => send({ type: "addWorkspace" })}
													status={desktop.agent.status}
													activity={desktop.agent.activity}
													queued={desktop.agent.queued.steering}
													onWithdraw={() => send({ type: "withdrawQueue" })}
													showThinking={settings.showThinking}
													showUsage={settings.showUsage}
													showToolDetails={settings.showToolDetails}
													theme={theme}
													onOpenExternal={(url) => send({ type: "openExternal", url })}
													onOpenChanges={(files, path) =>
														setDiff({ sessionId: activeSessionId, files, path })
													}
													onPrompt={(text) => send({ type: "prompt", text })}
												/>
											)}
											{immersive ? null : (
												<Composer
													sessionId={desktop.activeSessionId}
													workspace={desktop.workspace}
													workspaces={desktop.workspaces}
													platform={desktop.platform}
													agent={desktop.agent}
													models={state.models}
													thinking={settings.showThinking}
													sessionRestore={state.draftRestore}
													askDock={
														<AskDock
															asks={state.asks}
															activeSessionId={desktop.activeSessionId}
															onSubmit={(flowId, answers, note) =>
																send({ type: "askAnswer", flowId, answers, note })
															}
															onCancel={(flowId) => send({ type: "askCancel", flowId })}
														/>
													}
													immersive={immersive}
													onToggleImmersive={toggleImmersive}
													todoDock={
														// key 跟会话走：切回来时状态条是收起的一行，不在新会话里継承上一个的展开状态。
														<TodoDock key={desktop.activeSessionId ?? "none"} tasks={desktop.todos} />
													}
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
											)}
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
									</>
								)}
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
						showConversation();
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
