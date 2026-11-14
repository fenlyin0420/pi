// Electron 入口：装配设置、主题、会话中枢、窗口与菜单，并把 IPC 两个方向接起来。

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
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
	IPC_MESSAGE_IMAGE,
	IPC_OPEN_ATTACHMENT,
} from "../shared/contract.ts";
import { readImageView } from "./attachment-open.ts";
import { readAttachments } from "./attachments.ts";
import { searchProjectFiles } from "./file-search.ts";
import { IssuesService } from "./issues/service.ts";
import { installMenu } from "./menu.ts";
import { SessionHost } from "./session-host.ts";
import { SettingsStore } from "./settings.ts";
import { createMainWindow } from "./window.ts";

const platform = process.platform as Platform;
const settings = new SettingsStore(app.getPath("userData"));
let mainWindow: BrowserWindow | null = null;
/** 还没建 issues 服务前的空队列；快照对象复用，免每帧造新的。 */
const EMPTY_RUN: IssueRunView = { running: [], pending: 0, paused: false };
/** 先建宿主再建 issues：两边互相要用，用这个变量做后绑。 */
let issues: IssuesService | null = null;

// 和 electron-builder.yml 的 appId 保持一致：快捷方式带这个 AUMID，应用不声明就会被
// Windows 归到另一个任务栏分组，显示的是默认 electron 图标。
if (process.platform === "win32") app.setAppUserModelId("dev.fenlyin.pi-desktop");

function resolvedTheme(): ResolvedTheme {
	const configured = settings.get().theme;
	if (configured === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "light";
	return configured;
}

function send(event: DesktopEvent): void {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents.send(IPC_EVENT, event);
}

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

app.whenReady().then(async () => {
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
		}
	});
});

app.on("window-all-closed", () => {
	host.dispose();
	issues?.flush();
	settings.flush();
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	host.dispose();
	issues?.flush();
	settings.flush();
});
