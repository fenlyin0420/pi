// 一轮回答的渲染单元折叠规则：工具合并、思考与工具成链、单环不套壳。

import { describe, expect, it } from "vitest";
import { buildTurnEntries } from "../src/renderer/lib/turn-entries.ts";
import type { AssistantPart, ToolCallView } from "../src/shared/contract.ts";

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

describe("buildTurnEntries", () => {
	it("相邻工具调用合成一条链，单次调用直接铺开", () => {
		const two = buildTurnEntries([tool("a"), tool("b")], true);
		expect(two).toHaveLength(1);
		expect(two[0].kind).toBe("activity");
		expect(two[0].kind === "activity" && two[0].blocks[0]).toMatchObject({ kind: "tools" });

		const one = buildTurnEntries([tool("a")], true);
		expect(one).toHaveLength(1);
		expect(one[0].kind).toBe("tool");
	});

	it("思考与工具合成一条链，顺序不变", () => {
		const entries = buildTurnEntries([thinking("plan"), tool("a"), thinking("next"), tool("b")], true);
		expect(entries).toHaveLength(1);
		const entry = entries[0];
		expect(entry.kind).toBe("activity");
		if (entry.kind !== "activity") return;
		expect(entry.blocks.map((block) => block.kind)).toEqual(["thinking", "tools", "thinking", "tools"]);
	});

	it("文本把链切开，空文本不占位", () => {
		const entries = buildTurnEntries([tool("a"), text("hello"), tool("b")], true);
		expect(entries.map((entry) => entry.kind)).toEqual(["tool", "text", "tool"]);

		const sparse = buildTurnEntries([text(""), text("kept")], true);
		expect(sparse).toEqual([{ kind: "text", key: "text-1", text: "kept" }]);
	});

	it("关掉思考后整块消失，只剩工具链", () => {
		const parts: AssistantPart[] = [thinking("plan"), tool("a"), tool("b")];
		const withoutThinking = buildTurnEntries(parts, false);
		expect(withoutThinking).toHaveLength(1);
		const entry = withoutThinking[0];
		expect(entry.kind).toBe("activity");
		if (entry.kind !== "activity") return;
		expect(entry.blocks).toHaveLength(1);
		expect(entry.blocks[0].kind).toBe("tools");
		expect(entry.blocks[0].kind === "tools" && entry.blocks[0].calls.map((item) => item.id)).toEqual(["a", "b"]);

		// 只有思考时什么都不渲染，不留占位。
		expect(buildTurnEntries([thinking("plan")], false)).toEqual([]);
	});

	it("key 跟着第一个 part 的下标，追加内容不会改写已有单元的 key", () => {
		const before = buildTurnEntries([text("hi"), tool("a"), tool("b")], true);
		const after = buildTurnEntries([text("hi"), tool("a"), tool("b"), tool("c")], true);
		expect(after[0].key).toBe(before[0].key);
		expect(after[1].key).toBe(before[1].key);
	});
});
