// todo 结果投影的单元测试：认 pi-todo 的快照，别的东西一律不认。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { latestTodoTasks, readTodoCall } from "../src/main/todo-call.ts";

const DETAILS = {
	action: "update",
	params: { id: 3, status: "in_progress" },
	tasks: [
		{ id: 1, subject: "Write the parser", status: "completed" },
		{ id: 2, subject: "Wire the reducer", status: "deleted" },
		{
			id: 3,
			subject: "Add tests",
			status: "in_progress",
			activeForm: "adding tests",
			blockedBy: [1],
			owner: "executor",
			metadata: { note: "x" },
		},
	],
	nextId: 4,
};

describe("readTodoCall", () => {
	it("读出任务快照的每个界面字段", () => {
		expect(readTodoCall("todo", DETAILS)).toEqual({
			tasks: [
				{ id: 1, subject: "Write the parser", status: "completed", activeForm: null, blockedBy: [] },
				{ id: 2, subject: "Wire the reducer", status: "deleted", activeForm: null, blockedBy: [] },
				{
					id: 3,
					subject: "Add tests",
					status: "in_progress",
					activeForm: "adding tests",
					blockedBy: [1],
				},
			],
			error: null,
		});
	});

	it("被拒绝的调用把原因带出来", () => {
		const rejected = { ...DETAILS, error: "illegal transition completed → in_progress" };
		expect(readTodoCall("todo", rejected)?.error).toBe("illegal transition completed → in_progress");
		// 空字符串是“没有错误”，别在卡片上留一行空的错误。
		expect(readTodoCall("todo", { ...DETAILS, error: "" })?.error).toBeNull();
	});

	it("工具名不对、details 缺失或形状不对时返回 null，卡片退回普通工具", () => {
		expect(readTodoCall("edit", DETAILS)).toBeNull();
		expect(readTodoCall("todo", undefined)).toBeNull();
		expect(readTodoCall("todo", null)).toBeNull();
		expect(readTodoCall("todo", "no details")).toBeNull();
		expect(readTodoCall("todo", { tasks: "not an array" })).toBeNull();
	});

	it("单条任务坏掉只丢那一条，整份快照照常显示", () => {
		const partial = {
			tasks: [
				{ id: 1, subject: "kept", status: "pending" },
				{ id: 2, subject: "no status" },
				{ subject: "no id", status: "pending" },
				{ id: 4, subject: "bad status", status: "doing" },
				{ id: 5, subject: "mixed deps", status: "pending", blockedBy: [1, "2", null] },
			],
		};
		expect(readTodoCall("todo", partial)).toEqual({
			tasks: [
				{ id: 1, subject: "kept", status: "pending", activeForm: null, blockedBy: [] },
				{ id: 5, subject: "mixed deps", status: "pending", activeForm: null, blockedBy: [1] },
			],
			error: null,
		});
	});
});

/** 手写 pi 形状的 fixture：只填扫描读到的字段。 */
function messages(...items: unknown[]): AgentMessage[] {
	return items as AgentMessage[];
}

function todoResult(toolCallId: string, details: unknown) {
	return { role: "toolResult", toolCallId, toolName: "todo", content: [], details, isError: false, timestamp: 1 };
}

const USER = { role: "user", content: "go", timestamp: 1 };

describe("latestTodoTasks", () => {
	it("取会话里最后一份快照（就是现在的清单）", () => {
		const first = { tasks: [{ id: 1, subject: "one", status: "pending" }] };
		const second = { tasks: [{ id: 1, subject: "one", status: "completed" }] };
		expect(latestTodoTasks(messages(USER, todoResult("a", first), USER, todoResult("b", second)))).toEqual([
			{ id: 1, subject: "one", status: "completed", activeForm: null, blockedBy: [] },
		]);
	});

	it("最后那次快照读不出来时往回找上一份", () => {
		const good = { tasks: [{ id: 1, subject: "one", status: "pending" }] };
		expect(latestTodoTasks(messages(todoResult("a", good), todoResult("b", { tasks: 42 })))).toHaveLength(1);
	});

	it("没用过 todo、或只有别的工具的结果时是空清单", () => {
		expect(latestTodoTasks(messages(USER))).toEqual([]);
		expect(
			latestTodoTasks(
				messages({
					role: "toolResult",
					toolCallId: "x",
					toolName: "read",
					content: [],
					isError: false,
					timestamp: 1,
				}),
			),
		).toEqual([]);
	});

	it("clear 之后的空快照就是空清单，状态条会自己收起来", () => {
		const cleared = { tasks: [] };
		expect(latestTodoTasks(messages(todoResult("a", cleared)))).toEqual([]);
	});
});
