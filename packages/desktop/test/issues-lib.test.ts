// 渲染侧 issue 逻辑的单元测试：按 workspace 过滤、三档归类、侧栏条数。

import { describe, expect, it } from "vitest";
import {
	filterIssues,
	isQueued,
	issueCounts,
	issuesOf,
	openIssueCount,
	queueSelection,
	queueToggleable,
	statusLabel,
	withSummary,
} from "../src/renderer/lib/issues.ts";
import type { IssueStatus, IssueSummary } from "../src/shared/contract.ts";

function issue(number: number, status: IssueStatus, workspace = "/w"): IssueSummary {
	return {
		id: `id-${number}`,
		number,
		workspace,
		title: `issue ${number}`,
		status,
		createdAt: number,
		updatedAt: number,
		sessionId: null,
		blocked: null,
		error: null,
	};
}

const ALL = [
	issue(3, "closed"),
	issue(2, "review"),
	issue(1, "open"),
	issue(4, "running"),
	issue(5, "open", "/elsewhere"),
];

describe("issue list logic", () => {
	it("只取当前 workspace 的 issue，编号从大到小", () => {
		expect(issuesOf(ALL, "/w", "linux").map((entry) => entry.number)).toEqual([4, 3, 2, 1]);
		expect(issuesOf(ALL, null, "linux")).toEqual([]);
	});

	it("三档归类：active 含 open/queued/running，review 与 closed 各自一档", () => {
		const scoped = issuesOf(ALL, "/w", "linux");
		expect(filterIssues(scoped, "active").map((entry) => entry.number)).toEqual([4, 1]);
		expect(filterIssues(scoped, "review").map((entry) => entry.number)).toEqual([2]);
		expect(filterIssues(scoped, "closed").map((entry) => entry.number)).toEqual([3]);
	});

	it("计数与列表一致，侧栏徽标只数没关闭的", () => {
		const scoped = issuesOf(ALL, "/w", "linux");
		expect(issueCounts(scoped)).toEqual({ active: 2, review: 1, closed: 1 });
		expect(openIssueCount(scoped)).toBe(3);
	});

	it("状态文案覆盖每一个值", () => {
		expect(statusLabel("open")).toBe("Open");
		expect(statusLabel("queued")).toBe("Queued");
		expect(statusLabel("running")).toBe("Running");
		expect(statusLabel("review")).toBe("Review");
		expect(statusLabel("closed")).toBe("Closed");
	});

	it("复选框：open/review/queued 可改，running 与 closed 不可改", () => {
		const toggleable: IssueStatus[] = ["open", "review", "queued"];
		const locked: IssueStatus[] = ["running", "closed"];
		expect(toggleable.every((status) => queueToggleable(status))).toBe(true);
		expect(locked.every((status) => !queueToggleable(status))).toBe(true);
		expect(isQueued("queued")).toBe(true);
		expect(isQueued("running")).toBe(true);
		expect(isQueued("open")).toBe(false);
	});

	it("全选：只收可改的条目，都入队时变成全部取消", () => {
		const scoped = issuesOf(ALL, "/w", "linux");
		const before = queueSelection(filterIssues(scoped, "active"));
		expect(before.allQueued).toBe(false);
		// Active 里有一条 running：它在队列里但复选框锁住，不算全选目标。
		expect(before.ids).toEqual(["id-1"]);

		const allQueued = [issue(1, "queued"), issue(2, "queued"), issue(3, "closed")];
		const after = queueSelection(allQueued);
		expect(after.allQueued).toBe(true);
		expect(after.ids).toEqual(["id-1", "id-2"]);
	});

	it("详情状态以快照为准：排队后旧详情也跟着变", () => {
		const detail = { ...issue(1, "open"), body: "b", comments: [] };
		const merged = withSummary(detail, issue(1, "queued"));
		expect(merged.status).toBe("queued");
		expect(merged.body).toBe("b");
		expect(withSummary(detail, undefined)).toBe(detail);
	});
});
