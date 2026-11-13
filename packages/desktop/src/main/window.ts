// 主窗口：无框 + 自绘标题栏。macOS 用 hiddenInset（原生红绿灯），Windows 用无框窗口，三颗
// 按钮由界面画（`windowControl` 命令）——系统绘制的 Window Controls Overlay 画在网页之上，
// 遮罩、hover、主题色都盖不到它。Linux 用完整原生框。
// 几何、最大化状态进设置，外部链接一律交给系统浏览器。

import { join } from "node:path";
import { BrowserWindow, screen, shell } from "electron";
import type { ResolvedTheme } from "../shared/contract.ts";
import type { SettingsStore, WindowState } from "./settings.ts";

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;
const SAVE_DELAY_MS = 300;

export type WindowHooks = {
	theme(): ResolvedTheme;
	onMaximizeChange(maximized: boolean): void;
};

/** 创建主窗口。窗口在 ready-to-show 前保持隐藏，避免白底闪一帧。 */
export function createMainWindow(settings: SettingsStore, hooks: WindowHooks): BrowserWindow {
	const bounds = visibleBounds(settings.getWindow(), hooks.theme());
	const mac = process.platform === "darwin";
	const win = process.platform === "win32";
	const window = new BrowserWindow({
		width: bounds.width,
		height: bounds.height,
		...(bounds.x === null || bounds.y === null ? {} : { x: bounds.x, y: bounds.y }),
		minWidth: MIN_WIDTH,
		minHeight: MIN_HEIGHT,
		show: false,
		frame: !win,
		titleBarStyle: mac ? "hiddenInset" : "default",
		trafficLightPosition: mac ? { x: 14, y: 13 } : undefined,
		backgroundColor: hooks.theme() === "dark" ? "#181818" : "#ffffff",
		autoHideMenuBar: !mac,
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: true,
		},
	});

	const rendererUrl = process.env.ELECTRON_RENDERER_URL;
	if (rendererUrl) void window.loadURL(rendererUrl);
	else void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));

	window.once("ready-to-show", () => {
		if (settings.getWindow().maximized) window.maximize();
		window.show();
	});

	const persist = debounce(() => settings.updateWindow(currentBounds(window)), SAVE_DELAY_MS);
	window.on("resize", persist);
	window.on("move", persist);
	window.on("maximize", () => {
		settings.updateWindow({ maximized: true });
		hooks.onMaximizeChange(true);
	});
	window.on("unmaximize", () => {
		settings.updateWindow({ maximized: false });
		hooks.onMaximizeChange(false);
	});

	// 站内链接留在应用里；http(s) 交给系统浏览器，file 路径不交给 shell 打开。
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (url === window.webContents.getURL()) return;
		event.preventDefault();
		if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
	});

	return window;
}

/** 记住的几何可能来自已拔掉的显示器：落不到任何屏幕里就回到默认尺寸并居中。 */
function visibleBounds(state: WindowState, theme: ResolvedTheme): WindowState & { width: number; height: number } {
	void theme;
	if (state.x === null || state.y === null) return state;
	const inScreen = screen.getAllDisplays().some((display) => {
		const area = display.workArea;
		return (
			state.x !== null &&
			state.y !== null &&
			state.x >= area.x - 80 &&
			state.y >= area.y - 80 &&
			state.x < area.x + area.width - 80 &&
			state.y < area.y + area.height - 80
		);
	});
	return inScreen ? state : { ...state, x: null, y: null };
}

function currentBounds(window: BrowserWindow): Partial<WindowState> {
	const maximized = window.isMaximized();
	const bounds = maximized ? window.getNormalBounds() : window.getBounds();
	return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized };
}

function debounce<T extends () => void>(fn: T, delay: number): () => void {
	let timer: NodeJS.Timeout | null = null;
	return () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn();
		}, delay);
	};
}
