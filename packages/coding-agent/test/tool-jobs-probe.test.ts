import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { probeProcessTree } from "../src/core/tool-jobs/probe.ts";

const skipOnWindows = process.platform === "win32" ? it.skip : it;

describe("probeProcessTree", () => {
	skipOnWindows("reports the state and CPU time of a live process", async () => {
		const child = spawn("sleep", ["30"]);
		try {
			const facts = await probeProcessTree(child.pid as number);
			expect(facts.unavailable).toBeUndefined();
			expect(facts.processes).toBeGreaterThanOrEqual(1);
			expect(["R", "S"]).toContain(facts.state);
			expect(facts.cpuMs).toBeGreaterThanOrEqual(0);
		} finally {
			child.kill("SIGKILL");
		}
	});

	it("reports an exited process instead of throwing", async () => {
		const facts = await probeProcessTree(2_147_483_600);
		expect(facts.unavailable).toBeDefined();
		expect(facts.processes).toBe(0);
	});
});
