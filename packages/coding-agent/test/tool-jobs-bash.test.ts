import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { ToolSupervisor } from "../src/core/tool-jobs/index.ts";
import { DEFAULT_TOOL_SUPERVISION_LIMITS, ToolSupervisor as Supervisor } from "../src/core/tool-jobs/index.ts";
import { superviseTool } from "../src/core/tool-jobs/supervise-tool.ts";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";

const skipOnWindows = process.platform === "win32" ? it.skip : it;

function text(result: AgentToolResult<unknown>): string {
	return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

/** The bash tool as the session wires it: supervised deadlines, no kill timer inside the backend. */
function supervisedBash(softDeadlineMs: number): {
	supervisor: ToolSupervisor;
	tool: ReturnType<typeof superviseTool>;
} {
	const supervisor = new Supervisor({
		...DEFAULT_TOOL_SUPERVISION_LIMITS,
		softDeadlineMs,
		maxWallMs: 30_000,
		maxWaitMs: 10_000,
	});
	const tool = superviseTool(
		wrapToolDefinition(createBashToolDefinition(process.cwd(), { timeoutAction: "ignore" })),
		supervisor,
	);
	return { supervisor, tool };
}

describe("supervised bash", () => {
	skipOnWindows(
		"keeps a command past its deadline running and reports its process",
		async () => {
			const { supervisor, tool } = supervisedBash(150);
			const suspended = await tool.execute("call-1", { command: "sleep 30" }, undefined, undefined);
			const body = text(suspended);

			expect(body).toContain("suspended as job j1");
			expect(body).toContain("Process:");
			expect(body).toMatch(/state [RSD]/);
			expect(supervisor.listRunning().map((job) => job.id)).toEqual(["j1"]);

			// The command was suspended, not killed: it is still there to stop.
			const killed = await supervisor.kill("j1", "the evidence shows no progress");
			expect(killed.isError).toBe(true);
			expect(text(killed)).toContain("Stopped at your request");
			supervisor.dispose();
		},
		20_000,
	);

	skipOnWindows(
		"returns the real result when the command finishes inside a wait",
		async () => {
			const { supervisor, tool } = supervisedBash(100);
			const suspended = await tool.execute("call-2", { command: "sleep 0.4; echo done" }, undefined, undefined);
			expect(text(suspended)).toContain("suspended as job j1");

			const finished = await supervisor.wait("j1", 10_000, "output moved");
			expect(text(finished).trim()).toBe("done");
			expect(finished.isError).toBeUndefined();
			supervisor.dispose();
		},
		20_000,
	);

	skipOnWindows(
		"honours a declared timeout as the deadline",
		async () => {
			const { supervisor, tool } = supervisedBash(60_000);
			const started = Date.now();
			const suspended = await tool.execute("call-3", { command: "sleep 30", timeout: 0.15 }, undefined, undefined);

			expect(Date.now() - started).toBeLessThan(20_000);
			expect(text(suspended)).toContain("suspended as job j1");
			await supervisor.kill("j1", "test cleanup");
			supervisor.dispose();
		},
		20_000,
	);
});
