// 左侧栏：π 头部、项目切换、本地搜索、按时间分组的会话列表、会话对话框、底部动作与拖拽调宽。

import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { DesktopState, SessionSummary } from "../../../shared/contract.ts";
import {
	IconChevronDown,
	IconChevronRight,
	IconClose,
	IconMoon,
	IconPanelLeftClose,
	IconPlus,
	IconSearch,
	IconSettings,
	IconSun,
} from "../../icons.tsx";
import { sessionGroup } from "../../lib/format.ts";
import { Button, cx, Dialog, Field, IconButton, Kbd } from "../../ui.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { SessionRow } from "./SessionRow.tsx";

const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const RESIZE_STEP = 16;
/** 分组是按“今天/昨天”算的，一分钟刷新一次就够，行内不各自计时。 */
const TICK_MS = 60_000;

const GROUP_ORDER = ["Today", "Yesterday", "Last 7 days", "Older"] as const;

type SessionGroupKey = (typeof GROUP_ORDER)[number];
type SectionKey = SessionGroupKey | "pinned";
type SessionSection = { key: SectionKey; label: string; sessions: SessionSummary[] };

type SidebarProps = {
	state: DesktopState;
	collapsed: boolean;
	onOpenSession: (id: string) => void;
	onNewSession: () => void;
	onOpenProject: () => void;
	onOpenRecentProject: (path: string) => void;
	onRenameSession: (id: string, title: string) => void;
	onDeleteSession: (id: string) => void;
	onPinSession: (id: string, pinned: boolean) => void;
	onOpenSettings: () => void;
	onToggleCollapsed: () => void;
	onToggleTheme: () => void;
	onSearch: () => void;
	onResize: (width: number) => void;
};

/** 左侧栏本体；折叠时 App 用 CSS 隐藏它，组件本身照常渲染。 */
export function Sidebar({
	state,
	collapsed,
	onOpenSession,
	onNewSession,
	onOpenProject,
	onOpenRecentProject,
	onRenameSession,
	onDeleteSession,
	onPinSession,
	onOpenSettings,
	onToggleCollapsed,
	onToggleTheme,
	onSearch,
	onResize,
}: SidebarProps) {
	const [query, setQuery] = useState("");
	const [now, setNow] = useState(() => Date.now());
	const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
	const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
	const [renameTitle, setRenameTitle] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
	// 拖动中只改本地宽度，指针抬起时提交一次设置。
	const [draftWidth, setDraftWidth] = useState<number | null>(null);
	const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null);

	// App 传进来的两个回调是内联箭头函数，每次渲染都换身份；用 ref 转发让行 props 保持引用稳定，
	// 这样 React.memo 在拖动宽度、折叠分组时能跳过整个列表。
	const latestRowHandlers = useRef({ onOpenSession, onPinSession });
	useEffect(() => {
		latestRowHandlers.current = { onOpenSession, onPinSession };
	});

	const width = clampWidth(draftWidth ?? state.settings.sidebarWidth);
	// CSS 变量不在 CSSProperties 的类型里：只此一处 cast，让共享样式表里的宽度规则一起跟随。
	const widthVars = { "--ds-sidebar-width": `${width}px` } as CSSProperties;
	const searching = query.trim().length > 0;
	const shortcut = state.platform === "darwin" ? "⌘K" : "Ctrl K";
	const modelLabel = state.agent.modelName ?? state.agent.model ?? "No model";

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
		return () => window.clearInterval(timer);
	}, []);

	// 拖动中间被卸载时别把全局光标留在 col-resize。
	useEffect(() => () => document.documentElement.removeAttribute("data-sidebar-resizing"), []);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return state.sessions;
		return state.sessions.filter(
			(session) => session.title.toLowerCase().includes(needle) || session.preview.toLowerCase().includes(needle),
		);
	}, [state.sessions, query]);

	const sections = useMemo(() => buildSections(filtered, now), [filtered, now]);

	const toggleGroup = useCallback((key: string) => {
		setCollapsedGroups((previous) => ({ ...previous, [key]: !previous[key] }));
	}, []);

	const openSession = useCallback((id: string) => latestRowHandlers.current.onOpenSession(id), []);
	const pinSession = useCallback(
		(id: string, pinned: boolean) => latestRowHandlers.current.onPinSession(id, pinned),
		[],
	);

	const beginRename = useCallback((session: SessionSummary) => {
		setRenameTarget(session);
		setRenameTitle(session.title);
	}, []);

	const submitRename = () => {
		const target = renameTarget;
		const title = renameTitle.trim();
		if (!target || !title) return;
		onRenameSession(target.id, title);
		setRenameTarget(null);
	};

	const confirmDelete = () => {
		if (deleteTarget) onDeleteSession(deleteTarget.id);
		setDeleteTarget(null);
	};

	/** 指针拖动只改本地宽度；抬起是否提交由 finishResize 决定。 */
	const onResizePointerDown = (event: ReactPointerEvent<HTMLHRElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, width };
		setDraftWidth(width);
		document.documentElement.setAttribute("data-sidebar-resizing", "true");
	};

	const onResizePointerMove = (event: ReactPointerEvent<HTMLHRElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		drag.width = clampWidth(drag.startWidth + event.clientX - drag.startX);
		setDraftWidth(drag.width);
	};

	const finishResize = (commit: boolean, element?: HTMLHRElement, pointerId?: number) => {
		const drag = dragRef.current;
		dragRef.current = null;
		document.documentElement.removeAttribute("data-sidebar-resizing");
		if (element && pointerId !== undefined && element.hasPointerCapture(pointerId)) {
			element.releasePointerCapture(pointerId);
		}
		setDraftWidth(null);
		if (commit && drag && drag.width !== drag.startWidth) onResize(drag.width);
	};

	// 键盘同样能调宽：左右各 16px，Home/End 到两端，一次按键提交一次。
	const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLHRElement>) => {
		const next =
			event.key === "ArrowLeft"
				? clampWidth(width - RESIZE_STEP)
				: event.key === "ArrowRight"
					? clampWidth(width + RESIZE_STEP)
					: event.key === "Home"
						? MIN_WIDTH
						: event.key === "End"
							? MAX_WIDTH
							: null;
		if (next === null) return;
		event.preventDefault();
		if (next !== width) onResize(next);
	};

	const renderSection = (section: SessionSection) => {
		// 搜索时强制展开：命中项被折叠状态藏起来比折叠失效更糟。
		const groupCollapsed = !searching && collapsedGroups[section.key] === true;
		const labelId = `sidebar-group-${section.key.toLowerCase().replace(/\s+/g, "-")}`;
		return (
			<section key={section.key} className="sidebar-session-group" aria-labelledby={labelId}>
				<div className="sidebar-session-group-header">
					<button
						type="button"
						id={labelId}
						className="sidebar-session-group-title"
						aria-expanded={!groupCollapsed}
						onClick={() => toggleGroup(section.key)}
					>
						{groupCollapsed ? (
							<IconChevronRight size={12} aria-hidden="true" />
						) : (
							<IconChevronDown size={12} aria-hidden="true" />
						)}
						<span>{section.label}</span>
						<span className="sidebar-group-count">{section.sessions.length}</span>
					</button>
				</div>
				<div className={cx("sidebar-session-group-body", groupCollapsed && "is-collapsed")}>
					<ul className="sidebar-session-list">
						{section.sessions.map((session) => (
							<SessionRow
								key={session.id}
								session={session}
								active={session.id === state.activeSessionId}
								now={now}
								onOpen={openSession}
								onRename={beginRename}
								onDelete={setDeleteTarget}
								onPin={pinSession}
							/>
						))}
					</ul>
				</div>
			</section>
		);
	};

	return (
		<aside className="sidebar sidebar-surface" style={widthVars} aria-label="Sessions" inert={collapsed}>
			<div className="sidebar-header">
				<span className="brand" aria-hidden="true">
					π
				</span>
				<div className="sidebar-header-actions no-drag">
					<IconButton label="New session" onClick={onNewSession}>
						<IconPlus size={15} aria-hidden="true" />
					</IconButton>
					<IconButton label="Collapse sidebar" onClick={onToggleCollapsed}>
						<IconPanelLeftClose size={15} aria-hidden="true" />
					</IconButton>
				</div>
			</div>

			<div className="sidebar-body no-drag">
				<ProjectSwitcher
					cwd={state.cwd}
					recentProjects={state.recentProjects}
					onOpenProject={onOpenProject}
					onOpenRecentProject={onOpenRecentProject}
					onOpenSettings={onOpenSettings}
				/>

				<div className="sidebar-search">
					<IconSearch size={13} aria-hidden="true" />
					<input
						className="sidebar-search-input"
						type="text"
						value={query}
						placeholder="Search sessions"
						aria-label="Search sessions"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") setQuery("");
						}}
					/>
					{searching ? (
						<button
							type="button"
							className="sidebar-search-action"
							aria-label="Clear search"
							onClick={() => setQuery("")}
						>
							<IconClose size={12} aria-hidden="true" />
						</button>
					) : (
						<button
							type="button"
							className="sidebar-search-action"
							aria-label="Open command palette"
							onClick={onSearch}
						>
							<Kbd>{shortcut}</Kbd>
						</button>
					)}
				</div>
				{searching ? (
					<output className="sidebar-search-count">
						{filtered.length} {filtered.length === 1 ? "match" : "matches"}
					</output>
				) : null}

				<nav className="sidebar-session-groups" aria-label="Session list">
					{sections.length > 0 ? (
						sections.map(renderSection)
					) : (
						<div className="sidebar-empty">
							<p className="sidebar-session-empty">
								{searching ? "No sessions match your search." : "No sessions yet."}
							</p>
							{searching ? null : (
								<Button variant="secondary" onClick={onNewSession}>
									New session
								</Button>
							)}
						</div>
					)}
				</nav>

				<div className="sidebar-footer no-drag">
					<div className="footer-actions">
						<IconButton
							label={state.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
							onClick={onToggleTheme}
						>
							{state.theme === "dark" ? (
								<IconSun size={14} aria-hidden="true" />
							) : (
								<IconMoon size={14} aria-hidden="true" />
							)}
						</IconButton>
						<IconButton label="Settings" onClick={onOpenSettings}>
							<IconSettings size={14} aria-hidden="true" />
						</IconButton>
					</div>
					<span className="sidebar-footer-model" title={modelLabel}>
						{modelLabel}
					</span>
				</div>
			</div>

			<hr
				className={cx("sidebar-resize-handle", draftWidth !== null && "is-resizing")}
				aria-orientation="vertical"
				aria-label="Resize sidebar"
				aria-valuenow={width}
				aria-valuemin={MIN_WIDTH}
				aria-valuemax={MAX_WIDTH}
				tabIndex={0}
				onPointerDown={onResizePointerDown}
				onPointerMove={onResizePointerMove}
				onPointerUp={(event) => finishResize(true, event.currentTarget, event.pointerId)}
				onPointerCancel={(event) => finishResize(false, event.currentTarget, event.pointerId)}
				onKeyDown={onResizeKeyDown}
			/>

			<Dialog
				open={renameTarget !== null}
				onClose={() => setRenameTarget(null)}
				title="Rename session"
				footer={
					<>
						<Button variant="ghost" onClick={() => setRenameTarget(null)}>
							Cancel
						</Button>
						<Button variant="primary" onClick={submitRename} disabled={renameTitle.trim().length === 0}>
							Rename
						</Button>
					</>
				}
			>
				<Field label="Title">
					<input
						className="field-input"
						value={renameTitle}
						autoFocus
						onChange={(event) => setRenameTitle(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								submitRename();
							}
						}}
					/>
				</Field>
			</Dialog>

			<Dialog
				open={deleteTarget !== null}
				onClose={() => setDeleteTarget(null)}
				title="Delete session"
				footer={
					<>
						<Button variant="ghost" onClick={() => setDeleteTarget(null)}>
							Cancel
						</Button>
						<Button variant="primary" onClick={confirmDelete}>
							Delete
						</Button>
					</>
				}
			>
				<p>Delete “{deleteTarget?.title}”? The session file is removed from disk and this cannot be undone.</p>
			</Dialog>
		</aside>
	);
}

/** 置顶区在最前，其余按更新时间落到今天/昨天/过去 7 天/更早四档。 */
function buildSections(sessions: readonly SessionSummary[], now: number): SessionSection[] {
	const pinned: SessionSummary[] = [];
	const buckets = new Map<SessionGroupKey, SessionSummary[]>();
	for (const session of sessions) {
		if (session.pinned) {
			pinned.push(session);
			continue;
		}
		const key = sessionGroup(session.updatedAt, now);
		const bucket = buckets.get(key);
		if (bucket) bucket.push(session);
		else buckets.set(key, [session]);
	}

	const sections: SessionSection[] = [];
	if (pinned.length > 0) {
		sections.push({ key: "pinned", label: "Pinned", sessions: newestFirst(pinned) });
	}
	for (const key of GROUP_ORDER) {
		const bucket = buckets.get(key);
		if (bucket) sections.push({ key, label: key, sessions: newestFirst(bucket) });
	}
	return sections;
}

/** 会话列表可能来自多次刷新，渲染前统一按更新时间倒序一次。 */
function newestFirst(sessions: readonly SessionSummary[]): SessionSummary[] {
	return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 宽度夹在可用的最小/最大值之间。 */
function clampWidth(value: number): number {
	if (!Number.isFinite(value)) return MIN_WIDTH;
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}
