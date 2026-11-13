// Electron 入口：装配设置、主题、会话中枢、窗口与菜单，并把 IPC 两个方向接起来。

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import type { DesktopCommand, DesktopEvent, MenuAction, Platform, ResolvedTheme } from "../shared/contract.ts";
import { IPC_ATTACH_FILES, IPC_COMMAND, IPC_EVENT, IPC_GET_STATE } from "../shared/contract.ts";
import { readAttachments } from "./attachments.ts";
import { searchProjectFiles } from "./file-search.ts";
import { installMenu } from "./menu.ts";
import { SessionHost } from "./session-host.ts";
import { SettingsStore } from "./settings.ts";
import { createMainWindow, titleBarOverlay } from "./window.ts";

const platform = process.platform as Platform;
const settings = new SettingsStore(app.getPath("userData"));
let mainWindow: BrowserWindow | null = null;

function resolvedTheme(): ResolvedTheme {
	const configured = settings.get().theme;
	if (configured === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "light";
	return configured;
}

/** 系统窗口按钮的底色由 main 画，主题一变就得跟着换。只有 Windows 开了 WCO，别处调用会抛错。 */
function syncTitleBarOverlay(): void {
	if (process.platform !== "win32") return;
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.setTitleBarOverlay(titleBarOverlay(resolvedTheme()));
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
});

/** 原生文件选择器：取消时返回空列表，附件读取那边就什么都不加。 */
async function pickAttachmentPaths(): Promise<string[]> {
	const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
	return result.canceled ? [] : result.filePaths;
}

async function dispatch(command: DesktopCommand): Promise<void> {
	try {
		switch (command.type) {
			case "openExternal":
				if (command.url.startsWith("http://") || command.url.startsWith("https://")) {
					await shell.openExternal(command.url);
				}
				return;
			case "revealPath":
				shell.showItemInFolder(command.path);
				return;
			case "searchFiles": {
				const workspace = host.getWorkspace();
				const files = workspace === null ? [] : await searchProjectFiles(workspace, command.query);
				send({ type: "files", requestId: command.requestId, files });
				return;
			}
			case "listModels":
				host.listModels();
				return;
			case "updateSettings":
				await host.handle(command);
				syncTitleBarOverlay();
				return;
			default:
				await host.handle(command);
				return;
		}
	} catch (error) {
		send({ type: "toast", level: "error", message: error instanceof Error ? error.message : String(error) });
	}
}

app.whenReady().then(async () => {
	nativeTheme.on("updated", () => {
		if (settings.get().theme !== "system") return;
		syncTitleBarOverlay();
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
	settings.flush();
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
	host.dispose();
	settings.flush();
});
