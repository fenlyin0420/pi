// main 进程偏好持久化：settings.json 落在 Electron userData 下，写入去抖并原子替换。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Density, DesktopSettings, NoticeStyle, ThemeMode } from "../shared/contract.ts";

/** 窗口几何只在 main 进程使用，不进 renderer 的契约。 */
export type WindowState = {
	x: number | null;
	y: number | null;
	width: number;
	height: number;
	maximized: boolean;
};

const FILE_VERSION = 2;
const WRITE_DELAY_MS = 250;
const WORKSPACE_LIMIT = 20;
const PINNED_LIMIT = 500;
/** 记住的折叠分组条数上限：每个 workspace 至多几个分组（今天是/昨天/…），留出余量即可。 */
const GROUP_LIMIT = 200;
const MIN_FONT_SCALE = 0.85;
const MAX_FONT_SCALE = 1.4;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 560;
const MIN_DIFF_WIDTH = 320;
const MAX_DIFF_WIDTH = 900;
/** 队列并行的上限：再高就是同一项目里开太多会话改同一批文件。 */
const MIN_ISSUE_CONCURRENCY = 1;
const MAX_ISSUE_CONCURRENCY = 5;

/** 默认值即产品默认：深色跟随系统、正文 1.0 字号、会话栏展开。 */
export const DEFAULT_SETTINGS: DesktopSettings = {
	theme: "system",
	fontScale: 1,
	density: "comfortable",
	showThinking: true,
	showToolDetails: false,
	showUsage: true,
	notifyDesktop: true,
	// 默认每次都提示，跟 pi-notify 的 idle 一样；嫌扰就在设置里改成“仅不在前台”。
	notifyDesktopAwayOnly: false,
	// 默认走系统 toast：它会留在通知中心，弹窗消失也翻得到。
	notifyStyle: "native",
	sidebarWidth: 272,
	sidebarCollapsed: false,
	collapsedGroups: [],
	diffPanelWidth: 480,
	workspaces: [],
	activeWorkspace: null,
	pinnedSessions: [],
	immersiveSessions: [],
	issuesConcurrency: 3,
};

const DEFAULT_WINDOW: WindowState = { x: null, y: null, width: 1440, height: 900, maximized: false };

type PersistedFile = {
	version: number;
	settings: DesktopSettings;
	window: WindowState;
};

/**
 * 一个 JSON 文件持有全部本地偏好。读盘时逐字段校验（信任边界：用户手改或旧版本文件），
 * 写盘去抖 250ms 并通过临时文件重命名，避免半截文件。
 */
export class SettingsStore {
	private readonly file: string;
	private settings: DesktopSettings;
	private windowState: WindowState;
	private timer: NodeJS.Timeout | null = null;

	constructor(directory: string) {
		mkdirSync(directory, { recursive: true });
		this.file = join(directory, "settings.json");
		const loaded = readSettingsFile(this.file);
		this.settings = loaded.settings;
		this.windowState = loaded.window;
	}

	get(): DesktopSettings {
		return this.settings;
	}

	getWindow(): WindowState {
		return this.windowState;
	}

	/** 合并增量补丁并规范化；返回合并后的完整设置。 */
	update(patch: Partial<DesktopSettings>): DesktopSettings {
		this.settings = normalizeSettings({ ...this.settings, ...patch });
		this.scheduleWrite();
		return this.settings;
	}

	updateWindow(patch: Partial<WindowState>): void {
		this.windowState = { ...this.windowState, ...patch };
		this.scheduleWrite();
	}

	/** 打开的目录进 workspace 列表：去重、按加入顺序，不改变当前选中项。 */
	addWorkspace(path: string): DesktopSettings {
		if (this.settings.workspaces.some((entry) => entry === path)) return this.settings;
		this.settings = normalizeSettings({ ...this.settings, workspaces: [...this.settings.workspaces, path] });
		this.scheduleWrite();
		return this.settings;
	}

	/**
	 * 从 workspace 列表里拿掉一个目录，磁盘上的会话文件不受影响。
	 * 它正好是选中项时，选中项一并清空：留下一个不在列表里的目录，界面就有个选不中的当前项。
	 * 路径比较是严格相等，调用方负责按平台规范化成列表里存着的那一份。
	 */
	removeWorkspace(path: string): DesktopSettings {
		if (!this.settings.workspaces.includes(path)) return this.settings;
		const active = this.settings.activeWorkspace === path ? null : this.settings.activeWorkspace;
		this.settings = normalizeSettings({
			...this.settings,
			workspaces: this.settings.workspaces.filter((entry) => entry !== path),
			activeWorkspace: active,
		});
		this.scheduleWrite();
		return this.settings;
	}

	/** 记住当前选中的 workspace；传 null 表示回到“未选择”状态。 */
	setActiveWorkspace(path: string | null): DesktopSettings {
		this.settings = normalizeSettings({ ...this.settings, activeWorkspace: path });
		this.scheduleWrite();
		return this.settings;
	}

	flush(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.write();
	}

	private scheduleWrite(): void {
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			this.write();
		}, WRITE_DELAY_MS);
	}

	private write(): void {
		const payload: PersistedFile = { version: FILE_VERSION, settings: this.settings, window: this.windowState };
		const temporary = `${this.file}.tmp`;
		try {
			writeFileSync(temporary, `${JSON.stringify(payload, null, "\t")}\n`, "utf8");
			renameSync(temporary, this.file);
		} catch (error) {
			console.error("[desktop] settings write failed", error);
		}
	}
}

function readSettingsFile(file: string): { settings: DesktopSettings; window: WindowState } {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return { settings: DEFAULT_SETTINGS, window: DEFAULT_WINDOW };
	}
	if (!isRecord(raw)) return { settings: DEFAULT_SETTINGS, window: DEFAULT_WINDOW };
	return {
		settings: normalizeSettings({ ...DEFAULT_SETTINGS, ...migrateSettings(asRecord(raw.settings)) }),
		window: normalizeWindow({ ...DEFAULT_WINDOW, ...asRecord(raw.window) }),
	};
}

/** 旧版本只存最近打开过的目录；升级后它正好就是 workspace 列表的内容。 */
function migrateSettings(raw: Record<string, unknown>): Record<string, unknown> {
	if (raw.workspaces !== undefined) return raw;
	const recent = raw.recentProjects;
	if (!Array.isArray(recent)) return raw;
	return { ...raw, workspaces: recent };
}

/** 逐字段收敛：类型不对就用默认值，数值夹到合法区间。 */
function normalizeSettings(input: DesktopSettings): DesktopSettings {
	return {
		theme: pick<ThemeMode>(input.theme, ["system", "dark", "light"], DEFAULT_SETTINGS.theme),
		fontScale: clamp(Number(input.fontScale), MIN_FONT_SCALE, MAX_FONT_SCALE, DEFAULT_SETTINGS.fontScale),
		density: pick<Density>(input.density, ["comfortable", "compact"], DEFAULT_SETTINGS.density),
		showThinking: Boolean(input.showThinking),
		showToolDetails: Boolean(input.showToolDetails),
		showUsage: Boolean(input.showUsage),
		notifyDesktop: Boolean(input.notifyDesktop),
		notifyDesktopAwayOnly: Boolean(input.notifyDesktopAwayOnly),
		notifyStyle: pick<NoticeStyle>(input.notifyStyle, ["native", "card"], DEFAULT_SETTINGS.notifyStyle),
		sidebarWidth: Math.round(
			clamp(Number(input.sidebarWidth), MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, DEFAULT_SETTINGS.sidebarWidth),
		),
		sidebarCollapsed: Boolean(input.sidebarCollapsed),
		collapsedGroups: stringList(input.collapsedGroups, GROUP_LIMIT),
		diffPanelWidth: Math.round(
			clamp(Number(input.diffPanelWidth), MIN_DIFF_WIDTH, MAX_DIFF_WIDTH, DEFAULT_SETTINGS.diffPanelWidth),
		),
		workspaces: stringList(input.workspaces, WORKSPACE_LIMIT),
		activeWorkspace:
			typeof input.activeWorkspace === "string" && input.activeWorkspace ? input.activeWorkspace : null,
		pinnedSessions: stringList(input.pinnedSessions, PINNED_LIMIT),
		immersiveSessions: stringList(input.immersiveSessions, PINNED_LIMIT),
		issuesConcurrency: Math.round(
			clamp(
				Number(input.issuesConcurrency),
				MIN_ISSUE_CONCURRENCY,
				MAX_ISSUE_CONCURRENCY,
				DEFAULT_SETTINGS.issuesConcurrency,
			),
		),
	};
}

function normalizeWindow(input: WindowState): WindowState {
	return {
		x: typeof input.x === "number" && Number.isFinite(input.x) ? Math.round(input.x) : null,
		y: typeof input.y === "number" && Number.isFinite(input.y) ? Math.round(input.y) : null,
		width: Math.round(clamp(Number(input.width), 800, 8000, DEFAULT_WINDOW.width)),
		height: Math.round(clamp(Number(input.height), 560, 8000, DEFAULT_WINDOW.height)),
		maximized: Boolean(input.maximized),
	};
}

function stringList(value: unknown, limit: number): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string" || entry.length === 0 || seen.has(entry)) continue;
		seen.add(entry);
		result.push(entry);
		if (result.length >= limit) break;
	}
	return result;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}
