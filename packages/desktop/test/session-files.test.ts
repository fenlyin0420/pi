// 会话列表映射的单元测试：标题优先级、截断、预览行与时间字段。

import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { toSessionSummary } from "../src/main/session-files.ts";

function info(overrides: Partial<SessionInfo> = {}): SessionInfo {
	return {
		path: "/tmp/a.jsonl",
		id: "abc",
		cwd: "/tmp",
		created: new Date(1000),
		modified: new Date(2000),
		messageCount: 3,
		firstMessage: "First prompt",
		allMessagesText: "user: First prompt\nassistant: Done.",
		...overrides,
	};
}

describe("toSessionSummary", () => {
	it("用户命名的会话优先用名字", () => {
		expect(toSessionSummary(info({ name: "  Renamed  " }), false).title).toBe("Renamed");
	});

	it("没有名字时用首条消息，并把换行压成空格", () => {
		expect(toSessionSummary(info({ firstMessage: "line one\nline two" }), false).title).toBe("line one line two");
	});

	it("首条消息过长时截断", () => {
		const title = toSessionSummary(info({ firstMessage: "x".repeat(200) }), false).title;
		expect(title).toHaveLength(120);
		expect(title.endsWith("…")).toBe(true);
	});

	it("空会话给 Untitled", () => {
		expect(toSessionSummary(info({ firstMessage: "   " }), false).title).toBe("Untitled");
	});

	it("预览取最后一条非空消息", () => {
		expect(toSessionSummary(info({ allMessagesText: "a\n\nlast line  " }), false).preview).toBe("last line");
	});

	it("置顶标记与时间来自入参", () => {
		const summary = toSessionSummary(info(), true);
		expect(summary.pinned).toBe(true);
		expect(summary.updatedAt).toBe(2000);
		expect(summary.createdAt).toBe(1000);
		expect(summary.status).toBe("idle");
	});
});
