// issue 列表：勾选即入队（全选一次勾整列），行上右键出菜单，三档过滤在顶部。

import type { IssueSummary } from "../../../shared/contract.ts";
import {
	filterIssues,
	ISSUE_FILTERS,
	type IssueFilter,
	isQueued,
	issueCounts,
	queueSelection,
	queueToggleable,
	statusLabel,
	statusTone,
} from "../../lib/issues.ts";
import { Badge, cx, type MenuItem, useContextMenu } from "../../ui.tsx";

/** 一列 issue；勾选框是队列本身，选中行只是“在看哪一条”。 */
export function IssueList({
	issues,
	filter,
	selectedId,
	onFilter,
	onSelect,
	onSetQueue,
	onOpenThread,
	onDelete,
}: {
	issues: readonly IssueSummary[];
	filter: IssueFilter;
	selectedId: string | null;
	onFilter: (filter: IssueFilter) => void;
	onSelect: (id: string) => void;
	onSetQueue: (ids: readonly string[], queued: boolean) => void;
	onOpenThread: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const counts = issueCounts(issues);
	const shown = filterIssues(issues, filter);
	const selection = queueSelection(shown);
	const menu = useContextMenu();

	const openMenu = (event: { clientX: number; clientY: number; preventDefault(): void }, issue: IssueSummary) => {
		const queued = isQueued(issue.status);
		const items: MenuItem[] = [
			{ id: "select", label: "Show issue", onSelect: () => onSelect(issue.id) },
			{
				id: "thread",
				label: "Open thread",
				disabled: issue.sessionId === null,
				onSelect: () => onOpenThread(issue.id),
			},
			{
				id: "queue",
				label: queued ? "Remove from queue" : "Queue",
				disabled: !queueToggleable(issue.status),
				separatorBefore: true,
				onSelect: () => onSetQueue([issue.id], !queued),
			},
			{ id: "delete", label: "Delete issue", separatorBefore: true, onSelect: () => onDelete(issue.id) },
		];
		menu.open(event, items);
	};

	return (
		<div className="issue-list">
			<div className="issue-list-head">
				<label className="issue-check-wrap">
					<input
						className="issue-check"
						type="checkbox"
						aria-label="Queue all visible issues"
						checked={selection.allQueued}
						disabled={selection.ids.length === 0}
						onChange={() => onSetQueue(selection.ids, !selection.allQueued)}
					/>
					<span className="issue-check-label">Queue all</span>
				</label>
				<span className="issue-list-count">{shown.length}</span>
			</div>
			<div className="issue-filters" role="tablist" aria-label="Issue filter">
				{ISSUE_FILTERS.map((entry) => (
					<button
						key={entry.value}
						type="button"
						role="tab"
						aria-selected={entry.value === filter}
						className={cx("issue-filter", entry.value === filter && "is-active")}
						onClick={() => onFilter(entry.value)}
					>
						{entry.label}
						<span className="issue-filter-count">{counts[entry.value]}</span>
					</button>
				))}
			</div>
			{shown.length === 0 ? (
				<p className="issue-empty">No issues here.</p>
			) : (
				<ul className="issue-rows">
					{shown.map((issue) => (
						<li key={issue.id}>
							<div className={cx("issue-row", issue.id === selectedId && "is-active")}>
								<input
									className="issue-check"
									type="checkbox"
									aria-label={`Queue issue #${issue.number}`}
									checked={isQueued(issue.status)}
									disabled={!queueToggleable(issue.status)}
									onChange={(event) => onSetQueue([issue.id], event.target.checked)}
								/>
								<button
									type="button"
									className="issue-row-main"
									onClick={() => onSelect(issue.id)}
									onContextMenu={(event) => openMenu(event, issue)}
								>
									<span className="issue-row-head">
										<span className="issue-number">#{issue.number}</span>
										<span className="issue-row-title">{issue.title}</span>
									</span>
									<span className="issue-row-meta">
										<Badge tone={statusTone(issue.status)}>{statusLabel(issue.status)}</Badge>
										{issue.blocked ? <span className="issue-row-blocked">Needs input</span> : null}
									</span>
								</button>
							</div>
						</li>
					))}
				</ul>
			)}
			{menu.node}
		</div>
	);
}
