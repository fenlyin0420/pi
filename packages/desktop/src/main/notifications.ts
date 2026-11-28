// 右下角通知：一张浮在其它窗口之上的卡片，加一声提示音（pi-notify 的那个 chime）。
//
// 它是一个独立的无边框透明窗口，永远不抢焦点（focusable: false + showInactive 出场），
// 所以弹出来不会打断你正在敲的东西；点卡片才把主窗口叫到前台并切到那条会话。
// 卡片列表在渲染进程里自己管（叠几张、几秒退场），main 只做三件事：
// 推新卡片、按报上来的高度贴着屏幕右下角改大小、把点击转回 index。

import { join } from "node:path";
import { BrowserWindow, ipcMain, Notification, type Rectangle } from "electron";
import type { NoticeStyle, NoticeView, ResolvedTheme } from "../shared/contract.ts";
import { IPC_NOTICE_ACTIVATE, IPC_NOTICE_MEASURE, IPC_NOTICE_PUSH } from "../shared/notice-ipc.ts";
import { noticeBody, type SessionNotice, shouldNotify } from "./notify-policy.ts";

/** 卡片宽度：够放两行正文，又不至于横在桌面上。 */
const CARD_WIDTH = 360;
/** 与屏幕工作区右下角的间距：和系统通知一个量级。 */
const SCREEN_MARGIN = 16;
/** 还没量过高度时的猜测值：窗口先建出来，渲染进程报来真高度再改。 */
const FALLBACK_HEIGHT = 96;
/** 高度的合法上限：再多就是渲染进程算错了，不能让它把窗口拉到半屏高。 */
const MAX_HEIGHT = 640;

export type NotificationHooks = {
	theme(): ResolvedTheme;
	/** 设置里的通知总开关。 */
	enabled(): boolean;
	/** 设置里的“只在不在前台时提示”。 */
	awayOnly(): boolean;
	/** 主窗口此刻是否前台聚焦。 */
	windowFocused(): boolean;
	/** 设置里的出场方式：系统 toast（留在通知中心）还是自绘卡片。 */
	style(): NoticeStyle;
	/** 响一声：声音在主窗口里放（通知窗口可能压根不建）。 */
	chime(): void;
	/** 卡片贴哪块屏的右下角：跟着主窗口走，主窗口没了就是主屏。 */
	workArea(): Rectangle;
	/** 点了某张卡片：把主窗口叫到前台并切到那条会话。 */
	activate(sessionId: string): void;
};

export class NotificationHost {
	private readonly hooks: NotificationHooks;
	private window: BrowserWindow | null = null;
	private height = FALLBACK_HEIGHT;
	/** 页面装载完成前到的卡片：装载完一起补发，一张都不丢。 */
	private readonly queued: NoticeView[] = [];
	private loaded = false;
	private seq = 0;
	/** 卡片 id 到会话 id：渲染进程只知道自己那张卡的编号。 */
	private readonly sessionOf = new Map<number, string>();
	/**
	 * 还活着的系统 toast。Electron 的 Notification 只要没被垃圾回收就能在通知中心里留下来，
	 * 但它不会告诉我们用户什么时候从通知中心删掉，只能到应用退出时一次性清空。
	 */
	private readonly nativeToasts = new Set<Notification>();

	constructor(hooks: NotificationHooks) {
		this.hooks = hooks;
		ipcMain.on(IPC_NOTICE_MEASURE, this.onMeasure);
		ipcMain.on(IPC_NOTICE_ACTIVATE, this.onActivate);
	}

	/**
	 * 报一件值得弹窗的事。开关、是否在跟前、是不是被打断，全部在这里判：
	 * 调用方（会话中枢）只负责说清楚发生了什么。
	 */
	show(notice: SessionNotice): void {
		const allowed = shouldNotify({
			kind: notice.kind,
			enabled: this.hooks.enabled(),
			awayOnly: this.hooks.awayOnly(),
			aborted: notice.aborted,
			windowFocused: this.hooks.windowFocused(),
			sessionActive: notice.sessionActive,
		});
		if (!allowed) return;
		// 声音与出场方式无关：两种形态都是同一声 chime。
		this.hooks.chime();
		if (this.showNative(notice)) return;
		this.seq += 1;
		const view: NoticeView = {
			id: this.seq,
			kind: notice.kind,
			title: notice.title,
			body: noticeBody(notice.body),
			theme: this.hooks.theme(),
		};
		this.sessionOf.set(view.id, notice.sessionId);
		const window = this.ensureWindow();
		if (this.loaded) window.webContents.send(IPC_NOTICE_PUSH, view);
		else this.queued.push(view);
	}

	/** 应用退出：拆掉 IPC 与窗口，免得下一轮单实例重启时挂上第二份监听。 */
	dispose(): void {
		ipcMain.removeListener(IPC_NOTICE_MEASURE, this.onMeasure);
		ipcMain.removeListener(IPC_NOTICE_ACTIVATE, this.onActivate);
		this.nativeToasts.clear();
		if (this.window && !this.window.isDestroyed()) this.window.destroy();
		this.window = null;
		this.loaded = false;
		this.queued.length = 0;
		this.sessionOf.clear();
	}

	/**
	 * 系统 toast：与自绘卡片只能二选一。系统 toast 的横幅同样在右下角，两个一起弹就是两层，
	 * 而且它会把这条记录留在通知中心（弹窗消失也翻得到）——这正是自绘卡片做不到的那一半。
	 * 返回 false 表示没走这条路（设置选了卡片，或平台不支持），交给卡片去画。
	 */
	private showNative(notice: SessionNotice): boolean {
		if (this.hooks.style() !== "native" || !Notification.isSupported()) return false;
		const toast = new Notification({
			title: notice.title,
			body: noticeBody(notice.body),
			// 不传 icon：Windows 会把它画成正文左侧一大块方图（ChatGPT 桌面端没有那一块），
			// 标题栏里那颗小图标由系统按 AUMID 对应的快捷方式取，不是这里给的。
			// 声音由 pi-notify 那个 chime 自己放，系统那声提示音再加一层就重了。
			silent: true,
		});
		this.nativeToasts.add(toast);
		const drop = () => this.nativeToasts.delete(toast);
		toast.on("close", drop);
		toast.on("failed", drop);
		toast.on("click", () => {
			this.hooks.activate(notice.sessionId);
		});
		toast.show();
		return true;
	}

	/** 渲染进程报来的卡片堆叠高度：0 表示空了，藏窗口；否则贴右下角并显示。 */
	private readonly onMeasure = (_event: unknown, height: number): void => {
		const window = this.window;
		if (!window || window.isDestroyed()) return;
		const parsed = Number(height);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			window.hide();
			return;
		}
		this.height = Math.min(Math.round(parsed), MAX_HEIGHT);
		window.setBounds(this.boundsFor(this.height));
		if (!window.isVisible()) window.showInactive();
	};

	private readonly onActivate = (_event: unknown, id: number): void => {
		const sessionId = this.sessionOf.get(id);
		if (sessionId === undefined) return;
		this.sessionOf.delete(id);
		this.hooks.activate(sessionId);
	};

	/** 通知窗口只建一次，之后空了只是隐藏：卡片列表在渲染进程里，重建会丢。 */
	private ensureWindow(): BrowserWindow {
		if (this.window && !this.window.isDestroyed()) return this.window;
		const window = new BrowserWindow({
			...this.boundsFor(this.height),
			show: false,
			frame: false,
			transparent: true,
			backgroundColor: "#00000000",
			resizable: false,
			movable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			skipTaskbar: true,
			// 不抢焦点是这张窗口的全部意义：敲字、玩游戏都不该被它打断。
			focusable: false,
			alwaysOnTop: true,
			hasShadow: false,
			// 圆角由卡片自己的 CSS 画，窗口层不再切一刀（两刀会露出缝）。
			roundedCorners: false,
			webPreferences: {
				preload: join(import.meta.dirname, "../preload/notification.cjs"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		window.setAlwaysOnTop(true, "floating");
		// macOS 上全屏应用盖住一切：通知要留在上面；Windows 与 Linux 上是空操作。
		window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		window.on("closed", () => {
			this.window = null;
			this.loaded = false;
		});
		window.webContents.on("did-finish-load", () => {
			this.loaded = true;
			for (const view of this.queued.splice(0)) window.webContents.send(IPC_NOTICE_PUSH, view);
		});
		const devUrl = process.env.ELECTRON_RENDERER_URL;
		if (devUrl) void window.loadURL(`${devUrl}/notification.html`);
		else void window.loadFile(join(import.meta.dirname, "../renderer/notification.html"));
		this.window = window;
		return window;
	}

	/** 工作区右下角的位置：宽度固定，高度跟着卡片堆叠走，底边始终离任务栏 SCREEN_MARGIN。 */
	private boundsFor(height: number): Rectangle {
		const area = this.hooks.workArea();
		const safeHeight = Math.max(1, Math.min(height, MAX_HEIGHT));
		return {
			x: area.x + area.width - CARD_WIDTH - SCREEN_MARGIN,
			y: area.y + area.height - safeHeight - SCREEN_MARGIN,
			width: CARD_WIDTH,
			height: safeHeight,
		};
	}
}
