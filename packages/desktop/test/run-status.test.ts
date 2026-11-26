// 运行状态行：这一行文案与具体步骤无关、定期轮换；播报文案按步骤抽。

import { describe, expect, it } from "vitest";
import { pickPhrase, workingPhrase } from "../src/renderer/components/transcript/RunStatus.tsx";
import type { RunActivity } from "../src/shared/contract.ts";

const thinking: RunActivity = { kind: "thinking", tool: null, startedAt: 0 };
const tool: RunActivity = { kind: "tool", tool: "bash", startedAt: 0 };

describe("workingPhrase", () => {
	it("八秒换一句，不是每秒都跳", () => {
		expect(workingPhrase(0)).toBe(workingPhrase(7));
		expect(workingPhrase(8)).not.toBe(workingPhrase(0));
	});

	it("相邻两句不同，轮完一圈从头来", () => {
		const cycle = Array.from({ length: 10 }, (_, index) => workingPhrase(index * 8));
		for (let index = 1; index < cycle.length; index += 1) {
			expect(cycle[index]).not.toBe(cycle[index - 1]);
		}
		// 每句占八秒，轮完十句回到第一句
		expect(workingPhrase(80)).toBe(workingPhrase(0));
	});
});

describe("pickPhrase", () => {
	it("思考和执行各说各的", () => {
		expect(pickPhrase(tool, null)).toMatch(/^(Running|Executing|Calling|Using) bash$/);
		expect(pickPhrase(thinking, null)).not.toContain("bash");
	});

	it("换一步必换一句", () => {
		const thought = pickPhrase(thinking, null);
		expect(pickPhrase(thinking, thought)).not.toBe(thought);
		const executed = pickPhrase(tool, null);
		expect(pickPhrase(tool, executed)).not.toBe(executed);
	});

	it("同一类里也有多条可选", () => {
		const seen = new Set(Array.from({ length: 200 }, () => pickPhrase(thinking, null)));
		expect(seen.size).toBeGreaterThan(1);
	});
});
