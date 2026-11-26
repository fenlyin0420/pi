// 会话列表映射的单元测试：标题优先级、截断、预览行与时间字段。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { latestSessionIn, sessionTimes, toSessionSummary } from "../src/main/session-files.ts";
import type { SessionSummary } from "../src/shared/contract.ts";
import { folderName, samePath } from "../src/shared/paths.ts";

function message(timestamp: number): AgentMessage {
	return { role: "user", content: "hi", timestamp };
}

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

const WORKSPACE = "/tmp";

describe("toSessionSummary", () => {
	it("用户命名的会话优先用名字", () => {
		expect(toSessionSummary(info({ name: "  Renamed  " }), false, WORKSPACE).title).toBe("Renamed");
	});

	it("没有名字时用首条消息，并把换行压成空格", () => {
		expect(toSessionSummary(info({ firstMessage: "line one\nline two" }), false, WORKSPACE).title).toBe(
			"line one line two",
		);
	});

	it("首条消息过长时截断", () => {
		const title = toSessionSummary(info({ firstMessage: "x".repeat(200) }), false, WORKSPACE).title;
		expect(title).toHaveLength(120);
		expect(title.endsWith("…")).toBe(true);
	});

	it("空会话给 Untitled", () => {
		expect(toSessionSummary(info({ firstMessage: "   " }), false, WORKSPACE).title).toBe("Untitled");
	});

	it("预览取最后一条非空消息", () => {
		expect(toSessionSummary(info({ allMessagesText: "a\n\nlast line  " }), false, WORKSPACE).preview).toBe(
			"last line",
		);
	});

	it("置顶标记与时间来自入参", () => {
		const summary = toSessionSummary(info(), true, WORKSPACE);
		expect(summary.pinned).toBe(true);
		expect(summary.updatedAt).toBe(2000);
		expect(summary.createdAt).toBe(1000);
		expect(summary.status).toBe("idle");
	});

	it("workspace 取列目录时传入的目录", () => {
		expect(toSessionSummary(info(), false, "D:\\GitHub\\pi").workspace).toBe("D:\\GitHub\\pi");
	});
});

describe("sessionTimes", () => {
	it("时间取自消息自身，不取当前时刻", () => {
		expect(sessionTimes([message(5000), message(1000), message(3000)], 9000)).toEqual({
			createdAt: 1000,
			updatedAt: 5000,
		});
	});

	it("没有消息的空会话才用 now", () => {
		expect(sessionTimes([], 9000)).toEqual({ createdAt: 9000, updatedAt: 9000 });
	});
});

describe("latestSessionIn", () => {
	function summary(id: string, workspace: string, updatedAt: number): SessionSummary {
		return { ...toSessionSummary(info({ id }), false, workspace), updatedAt };
	}

	it("取列表里第一条落在该目录的会话（列表已按置顶/最近排好）", () => {
		const sessions = [
			summary("newest", "D:\\GitHub\\pi", 900),
			summary("second", "D:\\GitHub\\pi", 800),
			summary("other", "D:\\GitHub\\renderdoc", 950),
		];
		expect(latestSessionIn(sessions, "D:\\GitHub\\pi", "win32")?.id).toBe("newest");
	});

	it("目录写法不同也是同一个 workspace", () => {
		const sessions = [summary("a", "D:\\GitHub\\pi", 900)];
		expect(latestSessionIn(sessions, "d:/github/pi/", "win32")?.id).toBe("a");
	});

	it("没有同一目录的会话时返回 null（调用方据此开新会话）", () => {
		const sessions = [summary("a", "D:\\GitHub\\pi", 900)];
		expect(latestSessionIn(sessions, "D:\\home\\fenlyin\\homework", "win32")).toBeNull();
	});
});

describe("samePath", () => {
	it("Windows 上分隔符与大小写不算差别", () => {
		expect(samePath("D:\\GitHub\\pi", "d:/github/pi/", "win32")).toBe(true);
	});

	it("Linux 上大小写算差别", () => {
		expect(samePath("/srv/pi", "/srv/PI", "linux")).toBe(false);
	});

	it("不同目录不算同一项目", () => {
		expect(samePath("D:\\GitHub\\pi", "D:\\GitHub\\renderdoc", "win32")).toBe(false);
	});
});

describe("folderName", () => {
	it("取路径末段，忽略尾部斜杠", () => {
		expect(folderName("D:\\GitHub\\pi\\")).toBe("pi");
		expect(folderName("/srv/pi/")).toBe("pi");
	});
});
