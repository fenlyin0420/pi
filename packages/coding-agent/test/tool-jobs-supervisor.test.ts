import { spawn } from "node:child_process";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import {
	createJobToolDefinition,
	DEFAULT_TOOL_SUPERVISION_LIMITS,
	type SupervisedJob,
	type ToolSupervisionLimits,
	ToolSupervisor,
	unwrapSupervisedTool,
} from "../src/core/tool-jobs/index.ts";
import { superviseTool } from "../src/core/tool-jobs/supervise-tool.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";

const emptyParameters = Type.Object({});

function limits(overrides: Partial<ToolSupervisionLimits> = {}): ToolSupervisionLimits {
	return {
		...DEFAULT_TOOL_SUPERVISION_LIMITS,
		softDeadlineMs: 20,
		maxWallMs: 2000,
		maxJobs: 4,
		maxWaitMs: 100,
		...overrides,
	};
}

/** A tool that settles after `resolveAfterMs`, reporting `pid` so the supervisor can probe it. */
function slowTool(options: {
	name?: string;
	resolveAfterMs: number;
	pid?: number;
	onSettled?: () => void;
	abortResult?: AgentToolResult<unknown>;
}): AgentTool {
	const name = options.name ?? "slow";
	return {
		name,
		label: name,
		description: `${name} test tool`,
		parameters: emptyParameters,
		execute: (_toolCallId, _params, signal, onUpdate) =>
			new Promise<AgentToolResult<unknown>>((resolve) => {
				if (options.pid !== undefined) onUpdate?.({ content: [], details: { pid: options.pid } });
				const timer = setTimeout(() => {
					options.onSettled?.();
					resolve({ content: [{ type: "text", text: `${name} done` }], details: {} });
				}, options.resolveAfterMs);
				signal?.addEventListener("abort", () => {
					clearTimeout(timer);
					resolve(
						options.abortResult ?? {
							content: [{ type: "text", text: `${name} aborted` }],
							details: {},
							isError: true,
						},
					);
				});
			}),
	};
}

function text(result: AgentToolResult<unknown>): string {
	return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

describe("ToolSupervisor", () => {
	it("suspends a call past its deadline into a job that keeps running", async () => {
		const supervisor = new ToolSupervisor(limits());
		const tool = slowTool({ resolveAfterMs: 120 });
		const suspended = await supervisor.run(tool, {}, "call-1", undefined, undefined);

		expect(text(suspended)).toContain("is still running");
		expect(text(suspended)).toContain("suspended as job j1");
		expect(text(suspended)).toContain("Next: job ");
		expect(supervisor.listRunning().map((job) => job.id)).toEqual(["j1"]);

		const finished = await supervisor.wait("j1", 2000, "output and CPU moved");
		expect(text(finished)).toBe("slow done");
		expect(supervisor.listRunning()).toEqual([]);
	});

	it("reports the evidence the model decides on", async () => {
		const supervisor = new ToolSupervisor(limits());
		const suspended = await supervisor.run(slowTool({ resolveAfterMs: 80 }), {}, "call-2", undefined, undefined);
		const body = text(suspended);

		expect(body).toContain("Output:");
		expect(body).toContain("Assessment:");
		expect(body).toMatch(/left before the wall-clock limit stops it/);
		await supervisor.kill("j1", "test cleanup");
	});

	it("keeps waiting when no job slot is free", async () => {
		const supervisor = new ToolSupervisor(limits({ maxJobs: 1 }));
		const first = supervisor.run(
			slowTool({ name: "first", resolveAfterMs: 200 }),
			{},
			"call-1",
			undefined,
			undefined,
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
		// The second call cannot become a job and runs to completion instead.
		const second = await supervisor.run(
			slowTool({ name: "second", resolveAfterMs: 10 }),
			{},
			"call-2",
			undefined,
			undefined,
		);
		expect(text(second)).toBe("second done");
		await supervisor.kill("j1", "test cleanup");
		await first;
		supervisor.dispose();
	});

	it("stops a call at the wall-clock limit", async () => {
		const supervisor = new ToolSupervisor(limits({ maxWallMs: 60, maxWaitMs: 200 }));
		await supervisor.run(slowTool({ resolveAfterMs: 220 }), {}, "call-3", undefined, undefined);
		const result = await supervisor.wait("j1", 200, "still no progress");
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("wall-clock limit");
	});

	it("stops a call that makes no progress for three checks", async () => {
		const sleeper = spawn("sleep", ["30"]);
		const pid = sleeper.pid;
		const supervisor = new ToolSupervisor(limits({ softDeadlineMs: 10, maxWaitMs: 10, maxWallMs: 5000 }));
		try {
			await supervisor.run(slowTool({ resolveAfterMs: 10_000, pid }), {}, "call-4", undefined, undefined);
			await supervisor.wait("j1", 10, "no output");
			await supervisor.wait("j1", 10, "no output");
			const stopped = await supervisor.wait("j1", 10, "no output");
			expect(stopped.isError).toBe(true);
			expect(text(stopped)).toContain("No progress in 3 consecutive checks");
		} finally {
			sleeper.kill("SIGKILL");
			supervisor.dispose();
		}
	});

	it("reads the latest output of a running job", async () => {
		const definitions: ToolDefinition = {
			name: "talkative",
			label: "talkative",
			description: "streams output",
			parameters: emptyParameters,
			execute: (_toolCallId, _params, signal, onUpdate) =>
				new Promise<AgentToolResult<unknown>>((resolve) => {
					onUpdate?.({ content: [{ type: "text", text: "building" }], details: {} });
					signal?.addEventListener("abort", () => resolve({ content: [], details: {}, isError: true }));
				}),
		};
		const supervisor = new ToolSupervisor(limits());
		await supervisor.run(wrapToolDefinition(definitions), {}, "call-5", undefined, undefined);

		const output = supervisor.output("j1");
		expect(text(output)).toContain("Latest output of j1");
		expect(text(output)).toContain("building");
		await supervisor.kill("j1", "test cleanup");
	});

	it("notifies once when a suspended job settles in the background", async () => {
		const onSettled = vi.fn<(job: SupervisedJob) => void>();
		const supervisor = new ToolSupervisor(limits({ softDeadlineMs: 10 }), { onSettled });
		await supervisor.run(slowTool({ resolveAfterMs: 80 }), {}, "call-6", undefined, undefined);
		expect(onSettled).not.toHaveBeenCalled();

		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(onSettled).toHaveBeenCalledTimes(1);
		const job = onSettled.mock.calls[0]?.[0];
		expect(job?.result?.isError).toBeUndefined();
	});

	it("stops every job on interrupt", async () => {
		const supervisor = new ToolSupervisor(limits({ softDeadlineMs: 1000 }));
		const running = supervisor.run(slowTool({ resolveAfterMs: 10_000 }), {}, "call-7", undefined, undefined);
		await new Promise((resolve) => setTimeout(resolve, 10));
		supervisor.killAll();
		const result = await running;
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("session was interrupted");
	});

	it("wraps a tool and unwraps it again", () => {
		const definition: ToolDefinition = {
			name: "wrapme",
			label: "wrapme",
			description: "wrapped",
			parameters: emptyParameters,
			execute: async () => ({ content: [], details: {} }),
		};
		const tool = wrapToolDefinition(definition);
		const supervisor = new ToolSupervisor(limits());
		const supervised = superviseTool(tool, supervisor);

		expect(supervised).not.toBe(tool);
		expect(supervised.name).toBe("wrapme");
		expect(unwrapSupervisedTool(supervised)).toBe(tool);
		expect(unwrapSupervisedTool(tool)).toBe(tool);
		expect(superviseTool(tool, undefined)).toBe(tool);
		supervisor.dispose();
	});

	it("leaves calls it may not suspend to the tool", async () => {
		const supervisor = new ToolSupervisor(limits({ softDeadlineMs: 1 }));
		const tool: AgentTool = {
			...slowTool({ resolveAfterMs: 40 }),
			supervision: { suspendable: false },
		};
		const result = await supervisor.run(tool, {}, "call-8", undefined, undefined);
		expect(text(result)).toBe("slow done");
	});
});

describe("job tool", () => {
	const jobTool = (supervisor: ToolSupervisor) => {
		const definition = createJobToolDefinition(supervisor);
		return { definition, tool: wrapToolDefinition(definition) };
	};

	it("requires the evidence a decision was based on", async () => {
		const supervisor = new ToolSupervisor(limits());
		const { tool } = jobTool(supervisor);
		const result = await tool.execute("call-1", { action: "wait", id: "j1" }, undefined, undefined);
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("needs `reason`");
		supervisor.dispose();
	});

	it("reports unknown jobs with the ones that are running", async () => {
		const supervisor = new ToolSupervisor(limits());
		await supervisor.run(slowTool({ resolveAfterMs: 90 }), {}, "call-2", undefined, undefined);
		const { tool } = jobTool(supervisor);
		const result = await tool.execute("call-3", { action: "output", id: "j9" }, undefined, undefined);
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("Running jobs: j1");
		await supervisor.kill("j1", "test cleanup");
		supervisor.dispose();
	});

	it("waits in seconds and returns the finished result", async () => {
		const supervisor = new ToolSupervisor(limits());
		await supervisor.run(slowTool({ resolveAfterMs: 120 }), {}, "call-4", undefined, undefined);
		const { tool } = jobTool(supervisor);
		const result = await tool.execute(
			"call-5",
			{ action: "wait", id: "j1", timeout: 2, reason: "output moved" },
			undefined,
			undefined,
		);
		expect(text(result)).toBe("slow done");
		supervisor.dispose();
	});
});
