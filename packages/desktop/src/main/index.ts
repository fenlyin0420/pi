// Electron 入口：装配设置、主题、会话中枢、窗口与菜单，并把 IPC 两个方向接起来。

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import type { DesktopCommand, DesktopEvent, MenuAction, Platform, ResolvedTheme } from "../shared/contract.ts";
import { IPC_COMMAND, IPC_EVENT, IPC_GET_STATE } from "../shared/contract.ts";
import { searchProjectFiles } from "./file-search.ts";
import { installMenu } from "./menu.ts";
import { SessionHost } from "./session-host.ts";
import { SettingsStore } from "./settings.ts";
import { createMainWindow } from "./window.ts";

const platform = process.platform as Platform;
const settings = new SettingsStore(app.getPath("userData"));
let mainWindow: BrowserWindow | null = null;

function resolvedTheme(): ResolvedTheme {
	const configured = settings.get().theme;
	if (configured === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "light";
	return configured;
}

function send(event: DesktopEvent): void {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents.send(IPC_EVENT, event);
}

const host = new SessionHost(process.env.PI_DESKTOP_CWD ?? process.cwd(), {
	settings,
	platform,
	theme: resolvedTheme,
	emit: send,
	pickDirectory: async () => {
		const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
		return result.canceled ? null : (result.filePaths[0] ?? null);
	},
});

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
			case "searchFiles": {
				const files = await searchProjectFiles(host.getCwd(), command.query);
				send({ type: "files", requestId: command.requestId, files });
				return;
			}
			case "listModels":
				host.listModels();
				return;
			default:
				await host.handle(command);
				return;
		}
	} catch (error) {
		send({ type: "toast", level: "error", message: error instanceof Error ? error.message : String(error) });
	}
}

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
		if (settings.get().theme === "system") send({ type: "state", state: host.buildState() });
	});

	ipcMain.handle(IPC_GET_STATE, () => host.buildState());
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
