// 运行状态行：每一步一句文案、一个自己的秒表，换步骤就换句。

import { describe, expect, it } from "vitest";
import { pickPhrase } from "../src/renderer/components/transcript/RunStatus.tsx";
import { formatElapsed } from "../src/renderer/lib/format.ts";
import type { RunActivity } from "../src/shared/contract.ts";

const thinking: RunActivity = { kind: "thinking", tool: null, startedAt: 0 };
const tool: RunActivity = { kind: "tool", tool: "bash", startedAt: 0 };

describe("formatElapsed", () => {
	it("秒级只给秒", () => {
		expect(formatElapsed(0)).toBe("0s");
		expect(formatElapsed(12_400)).toBe("12s");
	});

	it("分钟级给分和补零的秒", () => {
		expect(formatElapsed(65_000)).toBe("1m 05s");
	});

	it("小时级只留整分", () => {
		expect(formatElapsed(3_725_000)).toBe("1h 02m");
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
