// transcript 映射的单元测试：消息 → item、工具状态与 diff、流式增量、纯文本投影。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { itemIdAt, toTranscriptItems } from "../src/main/transcript.ts";

/** 手写 pi 形状的 fixture：只填映射读到的字段，其余用 as 收口（生产类型分支太多，测试不复制）。 */
function messages(...items: unknown[]): AgentMessage[] {
	return items as AgentMessage[];
}

const USER = { role: "user", content: "hello", timestamp: 1 };

function assistant(content: unknown[], extra: Record<string, unknown> = {}) {
	return {
		role: "assistant",
		content,
		api: "openai",
		provider: "test",
		model: "m1",
		usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 0, totalTokens: 14, cost: { total: 0.01 } },
		stopReason: "stop",
		timestamp: 2,
		...extra,
	};
}

const TOOL_RESULT = {
	role: "toolResult",
	toolCallId: "call-1",
	toolName: "read",
	content: [{ type: "text", text: "file body" }],
	isError: false,
	timestamp: 3,
};

describe("toTranscriptItems", () => {
	it("先输出用户消息，并把图片数量单独记下", () => {
		const items = toTranscriptItems(
			messages({
				role: "user",
				content: [
					{ type: "text", text: "look" },
					{ type: "image", data: "x", mimeType: "image/png" },
				],
				timestamp: 1,
			}),
			{ streamingIndex: null },
		);
		expect(items[0]).toEqual({
			kind: "user",
			id: itemIdAt(0),
			text: "look",
			timestamp: 1,
			imageCount: 1,
			files: [],
			messageIndex: 0,
		});
	});

	it("正文里的附件块换成路径清单，气泡不再显示块本身", () => {
		const items = toTranscriptItems(
			messages({
				role: "user",
				content: "read this\n\n<attached-files>\n/tmp/report.pdf\n/tmp/a.ts\n</attached-files>",
				timestamp: 1,
			}),
			{ streamingIndex: null },
		);
		expect(items[0]).toMatchObject({ text: "read this", files: ["/tmp/report.pdf", "/tmp/a.ts"] });
	});

	it("把思考块和工具调用按顺序展开成 parts", () => {
		const items = toTranscriptItems(
			messages(
				USER,
				assistant([
					{ type: "thinking", thinking: "pondering" },
					{ type: "text", text: "answer" },
					{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "npm test" } },
				]),
				TOOL_RESULT,
			),
			{ streamingIndex: null },
		);
		const turn = items[1];
		if (turn?.kind !== "assistant") throw new Error("expected assistant item");
		expect(turn.parts.map((part) => part.type)).toEqual(["thinking", "text", "tool"]);
		const tool = turn.parts[2];
		if (tool?.type !== "tool") throw new Error("expected tool part");
		expect(tool.call).toMatchObject({
			name: "bash",
			state: "done",
			summary: "bash npm test",
			resultText: "file body",
			durationMs: null,
		});
		expect(turn.usage).toMatchObject({ input: 10, output: 4, cacheRead: 2, cost: 0.01 });
	});

	it("工具没有结果时：流式下标内和在跑的是 running，其余是 pending", () => {
		const item = (index: number | null, runningToolIds?: ReadonlyMap<string, unknown>) => {
			const items = toTranscriptItems(
				messages(USER, assistant([{ type: "toolCall", id: "c", name: "read", arguments: { path: "a.ts" } }])),
				{
					streamingIndex: index,
					runningToolIds,
				},
			);
			const turn = items[1];
			if (turn?.kind !== "assistant") throw new Error("expected assistant item");
			const part = turn.parts[0];
			return part?.type === "tool" ? part.call.state : null;
		};
		expect(item(1)).toBe("running");
		expect(item(null)).toBe("pending");
		// 消息已经落地、工具才刚起跑：没有结果，但 host 的步骤状态里有它。
		expect(item(null, new Map([["c", { tool: "read", startedAt: 1 }]]))).toBe("running");
		expect(item(null, new Map([["other", { tool: "read", startedAt: 1 }]]))).toBe("pending");
	});

	it("工具结果为错误时状态是 error", () => {
		const items = toTranscriptItems(
			messages(USER, assistant([{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } }]), {
				...TOOL_RESULT,
				isError: true,
			}),
			{ streamingIndex: null },
		);
		const turn = items[1];
		const part = turn?.kind === "assistant" ? turn.parts[0] : undefined;
		expect(part?.type === "tool" ? part.call.state : null).toBe("error");
	});

	it("edit 工具产生 diff，write 工具把 before 记为空", () => {
		const edit = toTranscriptItems(
			messages(
				assistant([
					{
						type: "toolCall",
						id: "e1",
						name: "edit",
						arguments: { path: "src/a.ts", edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }] },
					},
				]),
			),
			{ streamingIndex: null },
		);
		const editPart = edit[0]?.kind === "assistant" ? edit[0].parts[0] : undefined;
		expect(editPart?.type === "tool" ? editPart.call.diff : null).toEqual({
			path: "src/a.ts",
			before: "const a = 1;",
			after: "const a = 2;",
			truncated: false,
		});

		const write = toTranscriptItems(
			messages(
				assistant([{ type: "toolCall", id: "w1", name: "write", arguments: { path: "b.ts", content: "new" } }]),
			),
			{ streamingIndex: null },
		);
		const writePart = write[0]?.kind === "assistant" ? write[0].parts[0] : undefined;
		expect(writePart?.type === "tool" ? writePart.call.diff?.before : null).toBe("");
	});

	it("模型错误写进 assistant 的 error 字段，而不是单独一条 notice", () => {
		const items = toTranscriptItems(
			messages(USER, assistant([{ type: "text", text: "" }], { errorMessage: "boom" })),
			{ streamingIndex: null },
		);
		expect(items.some((item) => item.kind === "notice")).toBe(false);
		const turn = items[1];
		expect(turn?.kind === "assistant" ? turn.error : null).toBe("boom");
	});

	it("用户打断落成 interrupted，abort 的原因不归给模型错误", () => {
		const items = toTranscriptItems(
			messages(
				USER,
				assistant([{ type: "thinking", thinking: "half a thought" }], {
					stopReason: "aborted",
					errorMessage: "Operation aborted",
				}),
			),
			{ streamingIndex: null },
		);
		const turn = items[1];
		if (turn?.kind !== "assistant") throw new Error("expected assistant item");
		expect(turn.interrupted).toBe(true);
		expect(turn.error).toBeNull();
	});

	it("todo 工具把任务快照读成清单，摘要说清动了哪条", () => {
		const items = toTranscriptItems(
			messages(
				USER,
				assistant([
					{
						type: "toolCall",
						id: "t1",
						name: "todo",
						arguments: { action: "update", id: 3, status: "in_progress" },
					},
				]),
				{
					role: "toolResult",
					toolCallId: "t1",
					toolName: "todo",
					content: [{ type: "text", text: "Updated #3 (pending → in_progress)" }],
					details: {
						action: "update",
						params: { id: 3, status: "in_progress" },
						tasks: [{ id: 3, subject: "Add tests", status: "in_progress", activeForm: "adding tests" }],
						nextId: 4,
					},
					isError: false,
					timestamp: 3,
				},
			),
			{ streamingIndex: null },
		);
		const part = items[1]?.kind === "assistant" ? items[1].parts[0] : undefined;
		if (part?.type !== "tool") throw new Error("expected tool part");
		expect(part.call.summary).toBe("todo #3 in_progress");
		expect(part.call.todo).toEqual({
			tasks: [{ id: 3, subject: "Add tests", status: "in_progress", activeForm: "adding tests", blockedBy: [] }],
			error: null,
		});
	});

	it("todo 还没有结果时不带清单：跑着的那一下仍归普通工具卡片", () => {
		const items = toTranscriptItems(
			messages(USER, assistant([{ type: "toolCall", id: "t1", name: "todo", arguments: { action: "list" } }])),
			{ streamingIndex: 1 },
		);
		const part = items[1]?.kind === "assistant" ? items[1].parts[0] : undefined;
		if (part?.type !== "tool") throw new Error("expected tool part");
		expect(part.call.todo).toBeNull();
		expect(part.call.summary).toBe("todo list");
	});

	it("bash 执行消息渲染成 notice，失败退出码标记为 error", () => {
		const items = toTranscriptItems(
			messages({
				role: "bashExecution",
				command: "false",
				output: "",
				exitCode: 1,
				cancelled: false,
				truncated: false,
				timestamp: 4,
			}),
			{ streamingIndex: null },
		);
		expect(items[0]).toMatchObject({ kind: "notice", level: "error", text: "$ false (exit 1)" });
	});
});
