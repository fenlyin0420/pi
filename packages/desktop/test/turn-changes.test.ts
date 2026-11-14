// 轮末已编辑文件清单的折叠规则：同一路径合并成一次净变化，顺序按第一次动到。

import { describe, expect, it } from "vitest";
import { totalCounts, turnChanges } from "../src/renderer/lib/turn-changes.ts";
import type { AssistantPart, ToolCallView, TranscriptItem } from "../src/shared/contract.ts";

type AssistantItem = Extract<TranscriptItem, { kind: "assistant" }>;

function toolCall(path: string, before: string, after: string, truncated = false): ToolCallView {
	return {
		id: `tool-${path}-${after.length}`,
		name: "edit",
		state: "done",
		summary: `edit ${path}`,
		argsText: "",
		resultText: "",
		diff: { path, before, after, truncated },
		todo: null,
		durationMs: null,
	};
}

function call(part: ToolCallView): AssistantPart {
	return { type: "tool", call: part };
}

function item(...parts: AssistantPart[]): AssistantItem {
	return {
		kind: "assistant",
		id: `msg-${parts.length}`,
		parts,
		timestamp: 0,
		streaming: false,
		model: null,
		usage: null,
		interrupted: false,
		error: null,
	};
}

describe("turnChanges", () => {
	it("groups calls by path and keeps first-touch order", () => {
		const changes = turnChanges([
			item(call(toolCall("b.ts", "one\n", "one\ntwo\n")), call(toolCall("a.ts", "", "new\n"))),
		]);
		expect(changes.map((change) => change.path)).toEqual(["b.ts", "a.ts"]);
	});

	it("counts the net change of a file edited twice", () => {
		// 第一次把 two 写进去，第二次又把它改掉：整轮对文件来说是 0 增 0 删。
		const changes = turnChanges([
			item(call(toolCall("a.ts", "one\n", "one\ntwo\n"))),
			item(call(toolCall("a.ts", "one\ntwo\n", "one\n"))),
		]);
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ path: "a.ts", added: 0, deleted: 0, before: "one\n", after: "one\n" });
	});

	it("reports a write as added lines only", () => {
		const changes = turnChanges([item(call(toolCall("new.ts", "", "a\nb\nc\n")))]);
		expect(changes[0]).toMatchObject({ added: 3, deleted: 0, after: "a\nb\nc\n" });
	});

	it("marks a file whose diff was cut at the size limit", () => {
		const changes = turnChanges([
			item(call(toolCall("a.ts", "x\n", "x\ny\n")), call(toolCall("big.ts", "", "z\n", true))),
		]);
		expect(changes.find((change) => change.path === "big.ts")?.truncated).toBe(true);
		expect(changes.find((change) => change.path === "a.ts")?.truncated).toBe(false);
	});

	it("ignores tool calls without a diff", () => {
		const read: ToolCallView = { ...toolCall("a.ts", "", ""), name: "read", diff: null };
		expect(turnChanges([item(call(read))])).toEqual([]);
	});

	it("sums the whole turn", () => {
		const changes = turnChanges([
			item(call(toolCall("a.ts", "", "x\ny\n")), call(toolCall("b.ts", "old\n", "new\n"))),
		]);
		expect(totalCounts(changes)).toEqual({ added: 3, deleted: 1 });
	});
});
