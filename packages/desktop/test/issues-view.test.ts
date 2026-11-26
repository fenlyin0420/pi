// 记录到界面契约的映射：摘要不带正文，详情带正文与评论。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IssueStore } from "../src/main/issues/store.ts";
import { toIssueDetail, toIssueSummary } from "../src/main/issues/view.ts";

function freshStore(): IssueStore {
	return new IssueStore(mkdtempSync(join(tmpdir(), "pi-desktop-issues-view-")));
}

describe("issue views", () => {
	it("摘要不带正文，详情才带", () => {
		const store = freshStore();
		const record = store.create("/w", "title", "long body");
		const summary = toIssueSummary(record);
		const detail = toIssueDetail(record);
		expect("body" in summary).toBe(false);
		expect(detail.body).toBe("long body");
	});

	it("评论原样带到详情里，作者和时间都保留", () => {
		const store = freshStore();
		const record = store.create("/w", "title", "");
		store.comment(record.id, "agent", "progress");
		const detail = toIssueDetail(store.byId(record.id) ?? record);
		expect(detail.comments).toHaveLength(1);
		expect(detail.comments[0]?.author).toBe("agent");
		expect(detail.comments[0]?.text).toBe("progress");
	});

	it("blocked 与 error 会出现在摘要上，界面据此画提示", () => {
		const store = freshStore();
		const record = store.create("/w", "title", "");
		store.setStatus(record.id, "open", { blocked: "need a decision" });
		const summary = toIssueSummary(store.byId(record.id) ?? record);
		expect(summary.blocked).toBe("need a decision");
		expect(summary.status).toBe("open");
	});
});
