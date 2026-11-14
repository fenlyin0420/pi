// IssuesService 的单元测试：复选框的入队/出队、关闭与重开、删除都走白名单。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IssuesService } from "../src/main/issues/service.ts";
import type { DesktopEvent } from "../src/shared/contract.ts";

function harness(workspace: string | null = "/w") {
	const directory = mkdtempSync(join(tmpdir(), "pi-desktop-issues-service-"));
	const events: DesktopEvent[] = [];
	const notices: string[] = [];
	const service = new IssuesService({
		directory,
		emit: (event) => events.push(event),
		workspace: () => workspace,
		concurrency: () => 1,
		session: {
			ensure: async () => "session-1",
			prompt: async () => {},
			abort: async () => {},
			open: async () => {},
		},
		changed: () => {},
		notify: (_level, message) => notices.push(message),
	});
	const create = async (title: string) => {
		await service.handle({ type: "createIssue", title, body: "" });
		const record = service.summaries().find((issue) => issue.title === title);
		if (!record) throw new Error(`missing issue ${title}`);
		return record.id;
	};
	const statusOf = (id: string) => service.summaries().find((issue) => issue.id === id)?.status;
	return { service, events, notices, create, statusOf };
}

describe("IssuesService queue", () => {
	it("勾上把 open 与 review 放进队列，closed 不动", async () => {
		const h = harness();
		const open = await h.create("open one");
		const review = await h.create("review one");
		const closed = await h.create("closed one");
		await h.service.handle({ type: "closeIssue", id: closed });
		await h.service.handle({ type: "setIssueQueue", ids: [open, review, closed], queued: true });
		expect(h.statusOf(open)).toBe("queued");
		expect(h.statusOf(review)).toBe("queued");
		expect(h.statusOf(closed)).toBe("closed");
	});

	it("取消勾选把 queued 退回 open", async () => {
		const h = harness();
		const id = await h.create("one");
		await h.service.handle({ type: "setIssueQueue", ids: [id], queued: true });
		await h.service.handle({ type: "setIssueQueue", ids: [id], queued: false });
		expect(h.statusOf(id)).toBe("open");
	});

	it("关闭与重开各自只接受自己的前态", async () => {
		const h = harness();
		const id = await h.create("one");
		await h.service.handle({ type: "closeIssue", id });
		expect(h.statusOf(id)).toBe("closed");
		await h.service.handle({ type: "reopenIssue", id });
		expect(h.statusOf(id)).toBe("open");
		// 已经 open 的再关一次（它是允许的），但 reopen 一个 queued 不该生效。
		await h.service.handle({ type: "setIssueQueue", ids: [id], queued: true });
		await h.service.handle({ type: "reopenIssue", id });
		expect(h.statusOf(id)).toBe("queued");
	});

	it("删除发一条 detail: null，条目从列表里消失", async () => {
		const h = harness();
		const id = await h.create("one");
		await h.service.handle({ type: "deleteIssue", id });
		expect(h.service.summaries()).toHaveLength(0);
		expect(h.events.some((event) => event.type === "issueDetail" && event.detail === null)).toBe(true);
	});

	it("没有 workspace 时建不了 issue，只报一条提示", async () => {
		const h = harness(null);
		await h.service.handle({ type: "createIssue", title: "one", body: "" });
		expect(h.service.summaries()).toHaveLength(0);
		expect(h.notices[0]).toContain("workspace");
	});
});
