// 运行状态行的派生规则：从 steps 快照算出当前这一步，纯函数、只返回新对象。

import { describe, expect, it } from "vitest";
import {
	idleSteps,
	type RunSteps,
	stepActivity,
	thinkingSteps,
	toolEnded,
	toolStarted,
} from "../src/main/run-activity.ts";

describe("toolStarted", () => {
	it("记下工具名和起点，思考起点原样保留", () => {
		const steps = toolStarted(thinkingSteps(1_000), "call-1", "bash", 2_000);
		expect(steps.tools.get("call-1")).toEqual({ tool: "bash", startedAt: 2_000 });
		expect(steps.thinkingSince).toBe(1_000);
	});

	it("并行批次里另一件工具开始，不会顶掉第一件", () => {
		const first = toolStarted(thinkingSteps(1_000), "call-1", "bash", 2_000);
		const both = toolStarted(first, "call-2", "read", 2_500);
		expect(both.tools.size).toBe(2);
		expect(both.tools.get("call-1")).toEqual({ tool: "bash", startedAt: 2_000 });
	});
});

describe("toolEnded", () => {
	it("删掉这件工具，其它工具和思考起点不变", () => {
		const both = toolStarted(toolStarted(thinkingSteps(1_000), "call-1", "bash", 2_000), "call-2", "read", 2_500);
		const after = toolEnded(both, "call-1", 3_000);
		expect(after.tools.has("call-1")).toBe(false);
		expect(after.tools.get("call-2")).toEqual({ tool: "read", startedAt: 2_500 });
		expect(after.thinkingSince).toBe(1_000);
	});

	it("最后一件结束时思考从这一刻重新计时", () => {
		const steps = toolEnded(toolStarted(thinkingSteps(1_000), "call-1", "bash", 2_000), "call-1", 3_000);
		expect(steps.tools.size).toBe(0);
		expect(steps.thinkingSince).toBe(3_000);
	});

	it("未知的 toolCallId 不产生新的思考步", () => {
		const steps = toolStarted(thinkingSteps(1_000), "call-1", "bash", 2_000);
		const after = toolEnded(steps, "call-unknown", 3_000);
		expect(after.thinkingSince).toBe(1_000);
		expect(stepActivity(after)).toEqual({ kind: "tool", tool: "bash", startedAt: 2_000 });
		expect(stepActivity(toolEnded(idleSteps, "call-unknown", 3_000))).toBeNull();
	});

	it("不改入参对象", () => {
		const steps: RunSteps = toolStarted(thinkingSteps(1_000), "call-1", "bash", 2_000);
		const ended = toolEnded(steps, "call-1", 3_000);
		expect(steps.tools.get("call-1")).toEqual({ tool: "bash", startedAt: 2_000 });
		expect(steps.thinkingSince).toBe(1_000);
		expect(ended).not.toBe(steps);
		expect(idleSteps.tools.size).toBe(0);
	});
});

describe("stepActivity", () => {
	it("空闲时没有任何步骤", () => {
		expect(stepActivity(idleSteps)).toBeNull();
	});

	it("只有思考时显示思考，起点是思考起点", () => {
		expect(stepActivity(thinkingSteps(1_000))).toEqual({ kind: "thinking", tool: null, startedAt: 1_000 });
	});

	it("并行批次显示最早启动的那件工具", () => {
		const both = toolStarted(toolStarted(thinkingSteps(1_000), "call-1", "bash", 2_000), "call-2", "read", 2_500);
		expect(stepActivity(both)).toEqual({ kind: "tool", tool: "bash", startedAt: 2_000 });
	});

	it("最早那件结束后切到还在跑的另一件", () => {
		const both = toolStarted(toolStarted(thinkingSteps(1_000), "call-1", "bash", 2_000), "call-2", "read", 2_500);
		expect(stepActivity(toolEnded(both, "call-1", 3_000))).toEqual({
			kind: "tool",
			tool: "read",
			startedAt: 2_500,
		});
	});

	it("最后一件结束后变成思考，起点是结束时刻", () => {
		const both = toolStarted(toolStarted(thinkingSteps(1_000), "call-1", "bash", 2_000), "call-2", "read", 2_500);
		const done = toolEnded(toolEnded(both, "call-1", 3_000), "call-2", 3_200);
		expect(stepActivity(done)).toEqual({ kind: "thinking", tool: null, startedAt: 3_200 });
	});
});
