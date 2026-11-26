// 左侧栏：π 头部、workspace 列表（每个 workspace 下挂自己的会话）、本地搜索、会话对话框与拖拽调宽。

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
import type { DesktopState, SessionSummary, WorkspaceSummary } from "../../../shared/contract.ts";
import { samePath } from "../../../shared/paths.ts";
import { IconClose, IconFolderPlus, IconMoon, IconPlus, IconSearch, IconSettings, IconSun } from "../../icons.tsx";
import { sessionGroup } from "../../lib/format.ts";
import { Button, cx, Dialog, Field, IconButton, Kbd } from "../../ui.tsx";
import { RunningStatus } from "./RunningStatus.tsx";
import { SessionRow } from "./SessionRow.tsx";
import { UnreadDot } from "./UnreadDot.tsx";
import { WorkspaceRow } from "./WorkspaceRow.tsx";

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
	/** 在指定 workspace 里新建会话（侧栏文件夹的右键菜单）。 */
	onNewSessionIn: (path: string) => void;
	/** 把一个 workspace 从侧栏列表移除（侧栏文件夹的右键菜单）。 */
	onRemoveWorkspace: (path: string) => void;
	onAddWorkspace: () => void;
	onRenameSession: (id: string, title: string) => void;
	onDeleteSession: (id: string) => void;
	onPinSession: (id: string, pinned: boolean) => void;
	/** 折叠或展开一个分组（`<workspace>:<Today|Yesterday|…>`），由 App 写回设置。 */
	onToggleGroup: (key: string) => void;
	onOpenSettings: () => void;
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
	onNewSessionIn,
	onRemoveWorkspace,
	onAddWorkspace,
	onRenameSession,
	onDeleteSession,
	onPinSession,
	onToggleGroup,
	onOpenSettings,
	onToggleTheme,
	onSearch,
	onResize,
}: SidebarProps) {
	const [query, setQuery] = useState("");
	const [now, setNow] = useState(() => Date.now());
	// 分组折叠存在设置里（App 写回 main），重启后照样收着；搜索时不用它。
	const collapsedGroups = useMemo(() => new Set(state.settings.collapsedGroups), [state.settings.collapsedGroups]);
	/** 用户手动折叠/展开过的 workspace；没记录时按“当前 workspace 展开”决定。 */
	const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
	const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
	const [renameTitle, setRenameTitle] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
	// 拖动中只改本地宽度，指针抬起时提交一次设置；提交后本地值继续撑着，直到设置在同一个
	// 宽度上回推（main 写完设置才把新状态发回来）。中间放开会先跳回旧宽度再跳回新宽度。
	const [heldWidth, setHeldWidth] = useState<number | null>(null);
	const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null);

	// App 传进来的回调是内联箭头函数，每次渲染都换身份；用 ref 转发让列表行 props 保持引用稳定，
	// 这样 React.memo 在拖动宽度、折叠分组时能跳过整个列表。
	const latestRowHandlers = useRef({ onOpenSession, onPinSession, onNewSessionIn, onRemoveWorkspace });
	useEffect(() => {
		latestRowHandlers.current = { onOpenSession, onPinSession, onNewSessionIn, onRemoveWorkspace };
	});

	const settingsWidth = clampWidth(state.settings.sidebarWidth);
	const width = heldWidth ?? settingsWidth;
	// CSS 变量不在 CSSProperties 的类型里：只此一处 cast，让共享样式表里的宽度规则一起跟随。
	const widthVars = { "--ds-sidebar-width": `${width}px` } as CSSProperties;
	const searching = query.trim().length > 0;
	const shortcut = state.platform === "darwin" ? "⌘K" : "Ctrl K";
	const newSessionShortcut = state.platform === "darwin" ? "⌘N" : "Ctrl N";
	const hasWorkspace = state.workspace !== null;

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
		return () => window.clearInterval(timer);
	}, []);

	// 拖动中间被卸载时别把全局光标留在 col-resize。
	useEffect(() => () => document.documentElement.removeAttribute("data-sidebar-resizing"), []);

	// 设置回推到位就放开本地值：之后（含重启）都听设置的。
	useEffect(() => {
		if (heldWidth !== null && heldWidth === settingsWidth) setHeldWidth(null);
	}, [heldWidth, settingsWidth]);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return state.sessions;
		return state.sessions.filter(
			(session) => session.title.toLowerCase().includes(needle) || session.preview.toLowerCase().includes(needle),
		);
	}, [state.sessions, query]);

	/** 会话按 workspace 归堆，渲染时按 state.workspaces 的顺序取用。 */
	const sessionsByWorkspace = useMemo(() => {
		const map = new Map<string, SessionSummary[]>();
		for (const session of filtered) {
			const list = map.get(session.workspace);
			if (list) list.push(session);
			else map.set(session.workspace, [session]);
		}
		return map;
	}, [filtered]);

	// 翻转的是这一次渲染出来的展开状态，不是记录里的旧值：没记录的非当前 workspace 显示为收起，
	// 按 "!previous[path]" 推就会写成"收起"，点击看起来没反应。
	const toggleWorkspace = useCallback((path: string, expanded: boolean) => {
		setExpandedWorkspaces((previous) => ({ ...previous, [path]: !expanded }));
	}, []);

	const openSession = useCallback((id: string) => latestRowHandlers.current.onOpenSession(id), []);
	const pinSession = useCallback(
		(id: string, pinned: boolean) => latestRowHandlers.current.onPinSession(id, pinned),
		[],
	);
	const newSessionIn = useCallback((path: string) => latestRowHandlers.current.onNewSessionIn(path), []);
	const removeWorkspace = useCallback((path: string) => latestRowHandlers.current.onRemoveWorkspace(path), []);

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
		document.documentElement.setAttribute("data-sidebar-resizing", "true");
		setHeldWidth(width);
	};

	const onResizePointerMove = (event: ReactPointerEvent<HTMLHRElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		drag.width = clampWidth(drag.startWidth + event.clientX - drag.startX);
		setHeldWidth(drag.width);
	};

	/** 抬起时提交一次设置，本地值留到设置回推；取消或没挪动则直接回到设置里的宽度。 */
	const finishResize = (commit: boolean, element?: HTMLHRElement, pointerId?: number) => {
		const drag = dragRef.current;
		dragRef.current = null;
		document.documentElement.removeAttribute("data-sidebar-resizing");
		if (element && pointerId !== undefined && element.hasPointerCapture(pointerId)) {
			element.releasePointerCapture(pointerId);
		}
		if (commit && drag && drag.width !== drag.startWidth) {
			setHeldWidth(drag.width);
			onResize(drag.width);
			return;
		}
		setHeldWidth(null);
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
		if (next === width) return;
		setHeldWidth(next);
		onResize(next);
	};

	const renderGroup = (workspace: string, section: SessionSection) => {
		// 搜索时强制展开：命中项被折叠状态藏起来比折叠失效更糟。
		const groupKey = `${workspace}:${section.key}`;
		const groupCollapsed = !searching && collapsedGroups.has(groupKey);
		// 分组收起了才由自己报“里面有活”：展开时这个加载圈在会话行上。
		const groupRunning = groupCollapsed && section.sessions.some(isRunning);
		// 未读同理：收起时圆点上提到这一行，展开时落在会话行上。
		const groupUnread = groupCollapsed && section.sessions.some(isUnread);
		const labelId = `sidebar-group-${groupKey.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
		return (
			<section key={section.key} className="sidebar-session-group" aria-labelledby={labelId}>
				<div className="sidebar-session-group-header">
					<button
						type="button"
						id={labelId}
						className={cx("sidebar-session-group-title", groupCollapsed ? "is-collapsed" : "is-expanded")}
						aria-expanded={!groupCollapsed}
						onClick={() => onToggleGroup(groupKey)}
					>
						<span className="sidebar-group-label">{section.label}</span>
						{groupUnread ? <UnreadDot /> : null}
						<RunningStatus running={groupRunning} />
					</button>
				</div>
				<div className={cx("sidebar-session-group-body", groupCollapsed && "is-collapsed")} inert={groupCollapsed}>
					<div className="sidebar-session-group-clip">
						<ul className="sidebar-session-list">
							{section.sessions.map((session) => (
								<SessionRow
									key={session.id}
									session={session}
									active={session.id === state.activeSessionId}
									onOpen={openSession}
									onRename={beginRename}
									onDelete={setDeleteTarget}
									onPin={pinSession}
								/>
							))}
						</ul>
					</div>
				</div>
			</section>
		);
	};

	const renderWorkspace = (workspace: WorkspaceSummary) => {
		const sessions = sessionsByWorkspace.get(workspace.path) ?? [];
		// 搜索时只留命中的 workspace，并且强制展开。
		if (searching && sessions.length === 0) return null;
		const active = state.workspace !== null && samePath(workspace.path, state.workspace, state.platform);
		const expanded = searching || (expandedWorkspaces[workspace.path] ?? active);
		const sections = buildSections(sessions, now);
		// 收起时它藏起了自己的会话，所以由它报“里面有活”；展开时加载圈落在会话行（或其收起的
		// 分组行）上，workspace 行不再重复一次。未读标记走同一条分层规则。
		const running = !expanded && sessions.some(isRunning);
		const unread = !expanded && sessions.some(isUnread);
		return (
			<section key={workspace.path} className="sidebar-workspace">
				<WorkspaceRow
					workspace={workspace}
					active={active}
					expanded={expanded}
					running={running}
					unread={unread}
					onToggle={toggleWorkspace}
					onNewSession={newSessionIn}
					onRemove={removeWorkspace}
				/>
				{/* body 始终挂载、用 0fr/1fr 过渡收起，展开与折叠才有动画；收起时整段 inert。 */}
				<div className={cx("sidebar-workspace-body", !expanded && "is-collapsed")} inert={!expanded}>
					<div className="sidebar-workspace-clip">
						{sections.map((section) => renderGroup(workspace.path, section))}
					</div>
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
			</div>

			<div className="sidebar-body no-drag">
				{/* 新建会话占满一整行：它是侧栏最常用的动作，不再缩成标题栏里的一颗图标。 */}
				<button
					type="button"
					className="sidebar-new-session"
					aria-label="New session"
					disabled={!hasWorkspace}
					title={hasWorkspace ? "New session" : "Select a workspace first"}
					onClick={onNewSession}
				>
					<IconPlus size={15} aria-hidden="true" />
					<span className="sidebar-new-session-label">New session</span>
					<Kbd>{newSessionShortcut}</Kbd>
				</button>

				<div className="sidebar-section-header">
					<span className="sidebar-section-label">Workspaces</span>
					<IconButton label="Add workspace" onClick={onAddWorkspace}>
						<IconFolderPlus size={14} aria-hidden="true" />
					</IconButton>
				</div>

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

				<nav className="sidebar-session-groups" aria-label="Workspaces">
					{state.workspaces.length > 0 ? (
						state.workspaces.map(renderWorkspace)
					) : (
						<div className="sidebar-empty">
							<p className="sidebar-session-empty">No workspaces yet.</p>
							<Button variant="secondary" onClick={onAddWorkspace}>
								Add workspace
							</Button>
						</div>
					)}
					{searching && filtered.length === 0 ? (
						<p className="sidebar-session-empty">No sessions match your search.</p>
					) : null}
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
				</div>
			</div>

			<hr
				className={cx("sidebar-resize-handle", heldWidth !== null && "is-resizing")}
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

/** 正在跑一轮回答的会话：侧栏在它所在的那一行显示加载圈。 */
function isRunning(session: SessionSummary): boolean {
	return session.status === "running";
}

/** 后台跑出新回答、用户还没切回去看过的会话：侧栏在它所在的那一行显示圆点。 */
function isUnread(session: SessionSummary): boolean {
	return session.unread;
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
