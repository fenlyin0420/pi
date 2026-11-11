// 一轮回答的折叠规则：整轮并块、工具合并、思考成链、正文紧跟在它的过程后面。

import { describe, expect, it } from "vitest";
import { buildTurnEntries, groupTranscript, layoutTurn } from "../src/renderer/lib/turn-entries.ts";
import type { AssistantPart, ToolCallView, TranscriptItem } from "../src/shared/contract.ts";

function call(id: string): ToolCallView {
	return {
		id,
		name: "read",
		state: "done",
		summary: `read ${id}`,
		argsText: "",
		resultText: "",
		diff: null,
		durationMs: 10,
	};
}

const tool = (id: string): AssistantPart => ({ type: "tool", call: call(id) });
const text = (value: string): AssistantPart => ({ type: "text", text: value });
const thinking = (value: string): AssistantPart => ({ type: "thinking", text: value });

function assistant(id: string, parts: AssistantPart[], streaming = false): TranscriptItem {
	return { kind: "assistant", id, parts, timestamp: 0, streaming, model: null, usage: null, error: null };
}

/** 把构造出来的一轮记录收窄成 layoutTurn 接受的 assistant 数组。 */
function assistantItems(items: readonly TranscriptItem[]): Extract<TranscriptItem, { kind: "assistant" }>[] {
	return items.flatMap((item) => (item.kind === "assistant" ? [item] : []));
}

const user = (id: string): TranscriptItem => ({ kind: "user", id, text: id, timestamp: 0, imageCount: 0 });

describe("groupTranscript", () => {
	it("相邻的 assistant 记录并成一轮", () => {
		const blocks = groupTranscript([user("u1"), assistant("a1", [tool("x")]), assistant("a2", [text("done")])]);
		expect(blocks.map((block) => block.kind)).toEqual(["item", "turn"]);
		const turn = blocks[1];
		expect(turn.kind === "turn" && turn.items.map((item) => item.id)).toEqual(["a1", "a2"]);
	});

	it("用户消息和系统提示把轮切开", () => {
		const notice: TranscriptItem = { kind: "notice", id: "n1", level: "info", text: "hi", timestamp: 0 };
		const blocks = groupTranscript([assistant("a1", [text("x")]), user("u1"), notice]);
		expect(blocks.map((block) => block.kind)).toEqual(["turn", "item", "item"]);
	});
});

describe("buildTurnEntries", () => {
	it("相邻工具调用合成一条链", () => {
		const entries = buildTurnEntries([tool("a"), tool("b")], true);
		expect(entries).toHaveLength(1);
		const entry = entries[0];
		expect(entry.kind).toBe("activity");
		if (entry.kind !== "activity") return;
		expect(entry.blocks).toHaveLength(1);
		expect(entry.blocks[0].kind === "tools" && entry.blocks[0].calls.map((item) => item.id)).toEqual(["a", "b"]);
	});

	it("思考与工具合成一条链，顺序不变", () => {
		const entries = buildTurnEntries([thinking("plan"), tool("a"), thinking("next"), tool("b")], true);
		expect(entries).toHaveLength(1);
		const entry = entries[0];
		expect(entry.kind === "activity" && entry.blocks.map((block) => block.kind)).toEqual([
			"thinking",
			"tools",
			"thinking",
			"tools",
		]);
	});

	it("文本把链切开，空文本不占位", () => {
		expect(buildTurnEntries([tool("a"), text("hello"), tool("b")], true).map((entry) => entry.kind)).toEqual([
			"activity",
			"text",
			"activity",
		]);
		expect(buildTurnEntries([text(""), text("kept")], true)).toEqual([{ kind: "text", key: "text-1", text: "kept" }]);
	});

	it("关掉思考后整块消失，只剩工具链", () => {
		const entries = buildTurnEntries([thinking("plan"), tool("a")], false);
		expect(entries).toHaveLength(1);
		expect(entries[0].kind === "activity" && entries[0].blocks.map((block) => block.kind)).toEqual(["tools"]);
		expect(buildTurnEntries([thinking("plan")], false)).toEqual([]);
	});
});

describe("layoutTurn", () => {
	it("每个 step 的过程和它吐出的正文相邻", () => {
		const items = [
			assistant("a1", [thinking("plan"), tool("x"), text("A")]),
			assistant("a2", [thinking("plan2"), tool("y"), text("B")]),
		];
		const entries = layoutTurn(assistantItems(items), true);
		expect(entries.map((entry) => entry.kind)).toEqual(["activity", "text", "activity", "text"]);
		expect(entries.map((entry) => (entry.kind === "text" ? entry.text : ""))).toEqual(["", "A", "", "B"]);
	});

	it("相邻 loop 之间没有正文时并成同一行", () => {
		const items = [assistant("a1", [thinking("plan"), tool("x")]), assistant("a2", [tool("y")])];
		const entries = layoutTurn(assistantItems(items), true);
		expect(entries).toHaveLength(1);
		const chain = entries[0];
		expect(chain.kind === "activity" && chain.blocks.length).toBe(3);
	});

	it("每个 step 自己的思考不被后面的正文带走", () => {
		const items = [assistant("a1", [thinking("plan"), text("A"), tool("x"), text("B")])];
		const entries = layoutTurn(assistantItems(items), true);
		expect(entries.map((entry) => entry.kind)).toEqual(["activity", "text", "activity", "text"]);
	});

	it("不同 loop 的 key 不冲突", () => {
		const items = [assistant("a1", [tool("x")]), assistant("a2", [tool("y")])];
		const entries = layoutTurn(assistantItems(items), true);
		const chain = entries[0];
		if (chain.kind !== "activity") return;
		const keys = chain.blocks.map((block) => block.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
