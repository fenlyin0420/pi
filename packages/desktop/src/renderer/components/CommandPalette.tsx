// ⌘K 命令面板：动作和会话共用一个搜索框，方向键选、回车执行。

import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { SessionSummary, WorkspaceSummary } from "../../shared/contract.ts";
import {
	IconFolderOpen,
	IconIssues,
	IconPanelLeftClose,
	IconPlus,
	IconSearch,
	IconSettings,
	IconSparkles,
} from "../icons.tsx";
import { formatSessionTime } from "../lib/format.ts";
import { cx } from "../ui.tsx";

/** 面板能执行的动作；App 把它们折成对应的命令。 */
export type PaletteAction = "newSession" | "addWorkspace" | "settings" | "toggleSidebar" | "issues" | "immersive";

type Option =
	| { kind: "action"; id: string; action: PaletteAction; label: string; icon: ReactNode }
	| { kind: "session"; id: string; session: SessionSummary; workspace: string };

// 动作组永远排在会话组前面，索引顺序与渲染顺序一致。
const ACTIONS: readonly { action: PaletteAction; label: string; icon: ReactNode }[] = [
	{ action: "newSession", label: "New session", icon: <IconPlus size={15} /> },
	{ action: "addWorkspace", label: "Add workspace…", icon: <IconFolderOpen size={15} /> },
	{ action: "issues", label: "Issues", icon: <IconIssues size={15} /> },
	{ action: "immersive", label: "Toggle immersive mode", icon: <IconSparkles size={15} /> },
	{ action: "settings", label: "Settings", icon: <IconSettings size={15} /> },
	{ action: "toggleSidebar", label: "Toggle sidebar", icon: <IconPanelLeftClose size={15} /> },
];

const OPTION_ID_PREFIX = "command-palette-option-";

/** 渲染命令面板；关闭时什么都不留，打开时清空查询并聚焦输入框。 */
export function CommandPalette({
	open,
	sessions,
	workspaces,
	onClose,
	onOpenSession,
	onAction,
}: {
	open: boolean;
	sessions: readonly SessionSummary[];
	workspaces: readonly WorkspaceSummary[];
	onClose: () => void;
	onOpenSession: (id: string) => void;
	onAction: (action: PaletteAction) => void;
}) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);

	// 每次打开都回到空查询，并把焦点交给输入框：面板是键盘驱动的，指针只做备选。
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActive(0);
		inputRef.current?.focus();
	}, [open]);

	const { options, actionCount } = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const matchedActions: Option[] = ACTIONS.filter((entry) => entry.label.toLowerCase().includes(needle)).map(
			(entry) => ({
				kind: "action",
				id: entry.action,
				action: entry.action,
				label: entry.label,
				icon: entry.icon,
			}),
		);
		const names = new Map(workspaces.map((entry) => [entry.path, entry.name]));
		// 会话跨 workspace 混在同一列：每行带上它自己的 workspace 名，免得同名标题分不清。
		const matchedSessions: Option[] = sessions
			.filter(
				(session) =>
					!needle ||
					session.title.toLowerCase().includes(needle) ||
					session.preview.toLowerCase().includes(needle),
			)
			.map((session) => ({
				kind: "session",
				id: session.id,
				session,
				workspace: names.get(session.workspace) ?? session.workspace,
			}));
		return { options: [...matchedActions, ...matchedSessions], actionCount: matchedActions.length };
	}, [query, sessions, workspaces]);

	// 过滤后列表可能变短，选中项要跟着收敛，否则回车会落空。
	useEffect(() => {
		setActive((value) => Math.min(value, Math.max(options.length - 1, 0)));
	}, [options.length]);

	// 列表比弹层高时，键盘移动到的行要自己滚进可视区。
	useEffect(() => {
		if (!open) return;
		document.getElementById(`${OPTION_ID_PREFIX}${active}`)?.scrollIntoView({ block: "nearest" });
	}, [active, open]);

	if (!open) return null;

	const run = (option: Option) => {
		if (option.kind === "action") onAction(option.action);
		else onOpenSession(option.session.id);
	};

	const runActive = () => {
		if (options.length === 0) return;
		run(options[active]);
	};

	const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		// 输入法组字时方向键和回车属于候选框，不归列表。
		if (event.nativeEvent.isComposing) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActive((value) => Math.min(value + 1, options.length - 1));
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActive((value) => Math.max(value - 1, 0));
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			runActive();
		}
	};

	return (
		<div
			className="search-overlay"
			role="presentation"
			onPointerDown={(event) => event.target === event.currentTarget && onClose()}
		>
			<div
				className="search-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Command palette"
				onKeyDown={(event) => {
					// 焦点跑到结果行上时 Esc 也要能关，不只靠输入框里的处理。
					if (event.key !== "Escape") return;
					event.preventDefault();
					onClose();
				}}
			>
				<div className="search-input-row">
					<IconSearch size={16} aria-hidden="true" />
					<input
						ref={inputRef}
						className="search-input"
						role="combobox"
						aria-expanded="true"
						aria-controls="command-palette-results"
						aria-activedescendant={options.length > 0 ? `${OPTION_ID_PREFIX}${active}` : undefined}
						aria-label="Search sessions and actions"
						placeholder="Search sessions and actions…"
						value={query}
						maxLength={200}
						spellCheck={false}
						autoCorrect="off"
						autoCapitalize="off"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={onInputKeyDown}
					/>
				</div>
				<div id="command-palette-results" className="search-results" role="listbox" aria-label="Results">
					{actionCount > 0 ? (
						<div role="presentation">
							<div className="search-group-label" role="presentation">
								Actions
							</div>
							{options.slice(0, actionCount).map((option, index) => (
								<PaletteRow
									key={option.id}
									option={option}
									index={index}
									active={index === active}
									onActivate={setActive}
									onRun={run}
								/>
							))}
						</div>
					) : null}
					{options.length > actionCount ? (
						<div role="presentation">
							<div className="search-group-label" role="presentation">
								Sessions
							</div>
							{options.slice(actionCount).map((option, offset) => {
								const index = actionCount + offset;
								return (
									<PaletteRow
										key={option.id}
										option={option}
										index={index}
										active={index === active}
										onActivate={setActive}
										onRun={run}
									/>
								);
							})}
						</div>
					) : null}
					{options.length === 0 ? <div className="search-empty">No matches</div> : null}
				</div>
			</div>
		</div>
	);
}

type RowProps = {
	option: Option;
	index: number;
	active: boolean;
	onActivate: (index: number) => void;
	onRun: (option: Option) => void;
};

/** 一个结果行：动作只有图标和名称，会话多一行摘要，右侧是时间和运行中标记。 */
function PaletteRow({ option, index, active, onActivate, onRun }: RowProps) {
	return (
		<button
			id={`${OPTION_ID_PREFIX}${index}`}
			type="button"
			role="option"
			aria-selected={active}
			className={cx("search-item", active && "active")}
			onPointerEnter={() => onActivate(index)}
			onClick={() => onRun(option)}
		>
			{option.kind === "action" ? (
				<>
					<span className="search-item-icon" aria-hidden="true">
						{option.icon}
					</span>
					<span className="search-item-title">{option.label}</span>
				</>
			) : (
				<>
					<span className="search-item-main">
						<span className="search-item-title">{option.session.title}</span>
						{option.session.preview ? (
							<span className="search-item-preview">{option.session.preview}</span>
						) : null}
					</span>
					<span className="search-item-meta">
						{option.session.status === "running" ? (
							<span className="search-item-running" role="img" aria-label="Agent is running" />
						) : null}
						<span className="search-item-project">{option.workspace}</span>
						<span className="search-item-time">{formatSessionTime(option.session.updatedAt)}</span>
					</span>
				</>
			)}
		</button>
	);
}
