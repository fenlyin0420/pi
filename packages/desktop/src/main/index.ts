// Electron 入口：单实例守卫，拿到锁的实例装配设置、主题、会话中枢、窗口与菜单，并把 IPC 两个方向接起来。

import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell } from "electron";
import type {
	DesktopCommand,
	DesktopEvent,
	FileOpenResult,
	IssueRunView,
	MenuAction,
	Platform,
	ResolvedTheme,
} from "../shared/contract.ts";
import {
	IPC_ATTACH_FILES,
	IPC_COMMAND,
	IPC_EVENT,
	IPC_GET_STATE,
	IPC_ISSUE_IMAGE,
	IPC_MESSAGE_IMAGE,
	IPC_OPEN_ATTACHMENT,
	IPC_SAVE_ISSUE_IMAGE,
} from "../shared/contract.ts";
import { installArtifactProtocol, registerArtifactScheme } from "./artifact-protocol.ts";
import { readImageView } from "./attachment-open.ts";
import { readAttachments } from "./attachments.ts";
import { searchProjectFiles } from "./file-search.ts";
import { installWindowsNotificationIdentity } from "./identity.ts";
import { savePastedImage } from "./issue-image-paste.ts";
import { readIssueImage } from "./issue-images.ts";
import { IssuesService } from "./issues/service.ts";
import { installMenu } from "./menu.ts";
import { NotificationHost } from "./notifications.ts";
import { SessionHost } from "./session-host.ts";
import { SettingsStore } from "./settings.ts";
import { TaskbarBadge } from "./taskbar.ts";
import { createMainWindow } from "./window.ts";

const platform = process.platform as Platform;
/** 应用身份：与 electron-builder.yml 的 appId 一致（快捷方式、任务栏分组、通知身份都用它）。 */
const AUMID = "dev.fenlyin.pi-desktop";

// 特权 scheme 只认启动前声明的：这一行必须在 app ready 之前跑完。
registerArtifactScheme();

// 单实例：两个实例会共用同一份 userData，Chromium 的 profile 锁报错，双方还会互相覆盖 settings。
// 拿不到锁的实例直接退出，把窗口叫到前台交给已经在跑的那个（见下面的 second-instance）。
if (app.requestSingleInstanceLock()) {
	boot();
} else {
	app.quit();
}

/** 装配一个桌面实例：设置、主题、会话中枢、窗口、菜单与 IPC。 */
function boot(): void {
	const settings = new SettingsStore(app.getPath("userData"));
	let mainWindow: BrowserWindow | null = null;
	/** 还没建 issues 服务前的空队列；快照对象复用，免每帧造新的。 */
	const EMPTY_RUN: IssueRunView = { running: [], pending: 0, paused: false };
	/** 先建宿主再建 issues：两边互相要用，用这个变量做后绑。 */
	let issues: IssuesService | null = null;
	/** 右下角通知窗口；建在会话中枢之后，中枢只负责往里报事件。 */
	let notifier: NotificationHost | null = null;
	/** 提示音的序号：renderer 按它去重，连着两声都要响。 */
	let chimeSeq = 0;

	// 和 electron-builder.yml 的 appId 保持一致：快捷方式带这个 AUMID，应用不声明就会被
	// Windows 归到另一个任务栏分组，显示的是默认 electron 图标。
	// 同时把身份注册项里的图标指回一份稳定副本：那条路径会随仓库搬家悬空。
	if (process.platform === "win32") {
		app.setAppUserModelId(AUMID);
		installWindowsNotificationIdentity({
			aumid: AUMID,
			displayName: "Pi Desktop",
			// 白底黑线那颗：通知的标题栏比桌面图标小得多，奶油纸底在浅色通知面板上几乎看不出形状。
			iconSource: join(import.meta.dirname, "../../resources/notification-icon.png"),
		});
	}

	function resolvedTheme(): ResolvedTheme {
		const configured = settings.get().theme;
		if (configured === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "light";
		return configured;
	}

	function send(event: DesktopEvent): void {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		mainWindow.webContents.send(IPC_EVENT, event);
		// 会话切到了哪一条也算“看过了”：窗口在前台时，刚切到的会话把徽标上的那一条摸掉。
		if (event.type === "state" && isFocused()) taskbar.attend(host.getActiveSessionId());
	}

	/** 主窗口此刻是不是前台窗口（启动中与已关掉都算不在）。 */
	function isFocused(): boolean {
		return mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isFocused();
	}

	const taskbar = new TaskbarBadge(() => mainWindow);

	const host = new SessionHost(process.env.PI_DESKTOP_CWD ?? null, {
		settings,
		platform,
		theme: resolvedTheme,
		emit: send,
		pickDirectory: async () => {
			const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
			return result.canceled ? null : (result.filePaths[0] ?? null);
		},
		issues: {
			summaries: () => issues?.summaries() ?? [],
			runView: () => issues?.runView() ?? EMPTY_RUN,
		},
		issueTools: {
			forSession: (sessionId) => issues?.toolsForSession(sessionId) ?? [],
			forIssue: (issueId) => issues?.toolsForIssue(issueId) ?? [],
		},
		sessionRemoved: (sessionId) => issues?.detachSession(sessionId),
		notifyUser: (notice) => {
			notifier?.show(notice);
			// 任务栏上的数字是“弹过通知但还没回来看”：窗口在前台且看的就是这条时不算。
			if (!(isFocused() && notice.sessionActive)) taskbar.mark(notice.sessionId);
		},
	});

	notifier = new NotificationHost({
		theme: resolvedTheme,
		enabled: () => settings.get().notifyDesktop,
		awayOnly: () => settings.get().notifyDesktopAwayOnly,
		style: () => settings.get().notifyStyle,
		// 声音放在主窗口里：系统 toast 跟自绘卡片只能二选一，但哪一种都要响一声。
		chime: () => {
			chimeSeq += 1;
			send({ type: "chime", seq: chimeSeq });
		},
		// 主窗口没建出来（启动中）或已经关了，都算“人不在跟前”。
		windowFocused: () => mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isFocused(),
		workArea: () => {
			const live = mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null;
			return (live ? screen.getDisplayMatching(live.getBounds()) : screen.getPrimaryDisplay()).workArea;
		},
		// 点卡片：叫回主窗口，并切到发出这条通知的会话（会话可能已经被删了，handle 自己会忽略）。
		activate: (sessionId) => {
			if (!mainWindow || mainWindow.isDestroyed()) return;
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.show();
			mainWindow.focus();
			void host.handle({ type: "openSession", id: sessionId });
		},
	});

	issues = new IssuesService({
		directory: app.getPath("userData"),
		emit: send,
		workspace: () => host.getWorkspace(),
		concurrency: () => settings.get().issuesConcurrency,
		session: {
			ensure: (issue) => host.ensureIssueSession(issue),
			prompt: (sessionId, text) => host.promptSession(sessionId, text),
			abort: (sessionId) => host.abortSession(sessionId),
			open: (sessionId) => host.openSession(sessionId),
		},
		changed: () => host.touch(),
		notify: (level, message) => send({ type: "toast", level, message }),
	});

	/** 原生文件选择器：取消时返回空列表，附件读取那边就什么都不加。 */
	async function pickAttachmentPaths(): Promise<string[]> {
		const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
		return result.canceled ? [] : result.filePaths;
	}

	async function dispatch(command: DesktopCommand): Promise<void> {
		try {
			switch (command.type) {
				case "windowControl":
					applyWindowControl(command.action);
					return;
				case "openExternal":
					if (command.url.startsWith("http://") || command.url.startsWith("https://")) {
						await shell.openExternal(command.url);
					}
					return;
				case "revealPath":
					shell.showItemInFolder(command.path);
					return;
				case "openPath": {
					// openPath 用错误字符串报失败（空串是成功），同一个通道里转成 toast。
					const failure = await shell.openPath(command.path);
					if (failure) send({ type: "toast", level: "error", message: failure });
					return;
				}
				case "searchFiles": {
					const workspace = host.getWorkspace();
					const files = workspace === null ? [] : await searchProjectFiles(workspace, command.query);
					send({ type: "files", requestId: command.requestId, files });
					return;
				}
				case "listModels":
					host.listModels();
					return;
				default: {
					// issue 命令由 issues 服务兜，剩下的一律交给宿主。
					if (await issues?.handle(command)) return;
					await host.handle(command);
					return;
				}
			}
		} catch (error) {
			send({ type: "toast", level: "error", message: error instanceof Error ? error.message : String(error) });
		}
	}

	/** 三颗窗口按钮的动作；最大化键在已最大化时退回还原。 */
	function applyWindowControl(action: "minimize" | "maximize" | "close"): void {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		if (action === "minimize") mainWindow.minimize();
		else if (action === "maximize") {
			if (mainWindow.isMaximized()) mainWindow.unmaximize();
			else mainWindow.maximize();
		} else mainWindow.close();
	}

	// 第二次双击快捷方式：不是新开窗口，而是把已经在跑的那个叫到前台。
	app.on("second-instance", () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	});

	app.whenReady().then(async () => {
		// 产物帧的内容由自定义协议取：handler 要在建窗口之前就位，否则第一帧会 404。
		installArtifactProtocol({ theme: resolvedTheme });

		nativeTheme.on("updated", () => {
			if (settings.get().theme !== "system") return;
			send({ type: "state", state: host.buildState() });
		});

		ipcMain.handle(IPC_GET_STATE, () => host.buildState());
		// 附件：renderer 没给路径就是要原生选择器（工具栏的回形针），给了路径就是拖进窗口的文件。
		ipcMain.handle(IPC_ATTACH_FILES, async (_event, paths?: readonly string[]) => {
			const targets = paths ?? (await pickAttachmentPaths());
			const { attachments, rejected } = await readAttachments(targets);
			for (const message of rejected) send({ type: "toast", level: "warning", message });
			return attachments;
		});
		ipcMain.handle(IPC_OPEN_ATTACHMENT, async (_event, path: string): Promise<FileOpenResult> => {
			const image = await readImageView(path);
			if (image) return { kind: "image", image };
			const failure = await shell.openPath(path);
			if (!failure) return { kind: "external" };
			send({ type: "toast", level: "error", message: failure });
			return { kind: "failed" };
		});
		ipcMain.handle(IPC_MESSAGE_IMAGE, (_event, sessionId: string, messageIndex: number, imageIndex: number) =>
			host.messageImage(sessionId, messageIndex, imageIndex),
		);
		// issue 正文里的图片：渲染进程只认 data URL，路径的解析与读取都在 main 这边。
		ipcMain.handle(IPC_ISSUE_IMAGE, (_event, workspace: string | null, source: string) =>
			readIssueImage(workspace, source),
		);
		// 粘进正文的图存到 issues 目录：正文里只留一行 markdown，文件不进任何仓库。
		ipcMain.handle(IPC_SAVE_ISSUE_IMAGE, async (_event, data: string) => {
			const pasted = await savePastedImage(app.getPath("userData"), data);
			if (pasted.kind === "error") send({ type: "toast", level: "error", message: pasted.message });
			return pasted;
		});
		ipcMain.handle(IPC_COMMAND, async (_event, command: DesktopCommand) => {
			await dispatch(command);
		});

		installMenu((action: MenuAction) => send({ type: "menu", action }));

		mainWindow = createMainWindow(settings, {
			theme: resolvedTheme,
			onMaximizeChange: (maximized) => send({ type: "window", maximized }),
		});
		mainWindow.on("closed", () => {
			mainWindow = null;
		});
		// 新窗口的任务栏按钮是新的：徽标要重画到它身上。
		taskbar.sync();
		// 回到窗口就算看过当前这条：任务栏上那一条摸掉（别的会话的还留着）。
		mainWindow.on("focus", () => taskbar.attend(host.getActiveSessionId()));
		mainWindow.webContents.on("did-finish-load", () => {
			if (mainWindow && !mainWindow.isDestroyed()) send({ type: "window", maximized: mainWindow.isMaximized() });
		});

		await host.start();
		send({ type: "state", state: host.buildState() });
		host.listModels();

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				mainWindow = createMainWindow(settings, {
					theme: resolvedTheme,
					onMaximizeChange: (maximized) => send({ type: "window", maximized }),
				});
				mainWindow.on("closed", () => {
					mainWindow = null;
				});
				mainWindow.on("focus", () => taskbar.attend(host.getActiveSessionId()));
				taskbar.sync();
			}
		});
	});

	app.on("window-all-closed", () => {
		host.dispose();
		notifier?.dispose();
		issues?.flush();
		settings.flush();
		if (process.platform !== "darwin") app.quit();
	});

	app.on("before-quit", () => {
		host.dispose();
		notifier?.dispose();
		issues?.flush();
		settings.flush();
	});
}
