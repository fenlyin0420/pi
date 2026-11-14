// issues 的纯展示逻辑：按 workspace 过滤、按状态分组、标注文案。没有 React，好测。

import type { IssueDetail, IssueStatus, IssueSummary, Platform } from "../../shared/contract.ts";
import { samePath } from "../../shared/paths.ts";

/** 列表上方的三档；queued 和 running 都算 active，用行内状态点区分。 */
export type IssueFilter = "active" | "review" | "closed";

export const ISSUE_FILTERS: readonly { value: IssueFilter; label: string }[] = [
	{ value: "active", label: "Active" },
	{ value: "review", label: "Review" },
	{ value: "closed", label: "Closed" },
];

const ACTIVE: readonly IssueStatus[] = ["open", "queued", "running"];

/** 当前 workspace 的 issue，编号从大到小。 */
export function issuesOf(
	issues: readonly IssueSummary[],
	workspace: string | null,
	platform: Platform,
): IssueSummary[] {
	if (workspace === null) return [];
	return issues.filter((issue) => samePath(issue.workspace, workspace, platform)).sort((a, b) => b.number - a.number);
}

export function filterIssues(issues: readonly IssueSummary[], filter: IssueFilter): IssueSummary[] {
	const allowed = filter === "active" ? ACTIVE : filter === "review" ? ["review"] : ["closed"];
	return issues.filter((issue) => allowed.includes(issue.status));
}

/** 三档各自的条数，给列表上方的 tab 用。 */
export function issueCounts(issues: readonly IssueSummary[]): Record<IssueFilter, number> {
	let active = 0;
	let review = 0;
	let closed = 0;
	for (const issue of issues) {
		if (ACTIVE.includes(issue.status)) active += 1;
		else if (issue.status === "review") review += 1;
		else closed += 1;
	}
	return { active, review, closed };
}

/** 侧栏徽标：还没关闭的条数。 */
export function openIssueCount(issues: readonly IssueSummary[]): number {
	return issues.filter((issue) => issue.status !== "closed").length;
}

/** 复选框能不能改：open 与 review 可以勾上入队，queued 可以取消，closed 与 running 不行。 */
export function queueToggleable(status: IssueStatus): boolean {
	return status === "open" || status === "review" || status === "queued";
}

/** 复选框的选中态：queued 与 running 都算“在队列里”，running 只是已经开跑。 */
export function isQueued(status: IssueStatus): boolean {
	return status === "queued" || status === "running";
}

/**
 * 全选的目标：当前列表里能改的条目。若它们已经全在队列里，全选就变成“全部取消”，
 * 所以把两个事实一起给调用方。
 */
export function queueSelection(issues: readonly IssueSummary[]): { allQueued: boolean; ids: string[] } {
	const toggleable = issues.filter((issue) => queueToggleable(issue.status));
	return {
		allQueued: toggleable.length > 0 && toggleable.every((issue) => isQueued(issue.status)),
		ids: toggleable.map((issue) => issue.id),
	};
}

/**
 * 详情面板的状态字段以快照里的摘要为准：排队、运行、关闭只改摘要，正文与评论才走 issueDetail 事件。
 * 两边拼起来，详情里的状态就不会停在上一次事件那一刻。
 */
export function withSummary(detail: IssueDetail, summary: IssueSummary | undefined): IssueDetail {
	if (!summary) return detail;
	return {
		...detail,
		title: summary.title,
		status: summary.status,
		blocked: summary.blocked,
		error: summary.error,
		sessionId: summary.sessionId,
		updatedAt: summary.updatedAt,
	};
}

export function statusLabel(status: IssueStatus): string {
	switch (status) {
		case "open":
			return "Open";
		case "queued":
			return "Queued";
		case "running":
			return "Running";
		case "review":
			return "Review";
		case "closed":
			return "Closed";
	}
}

/** 状态点在列表行上的色调；running 单独画加载圈。 */
export function statusTone(status: IssueStatus): "neutral" | "success" | "warning" | "error" {
	switch (status) {
		case "open":
			return "neutral";
		case "queued":
			return "warning";
		case "running":
			return "warning";
		case "review":
			return "warning";
		case "closed":
			return "success";
	}
}
