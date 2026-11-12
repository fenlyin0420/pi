import { describe, expect, it } from "vitest";
import { assessProgress, formatDuration } from "../src/core/tool-jobs/evidence.ts";
import type { ProcessFacts } from "../src/core/tool-jobs/probe.ts";

const facts = (overrides: Partial<ProcessFacts> = {}): ProcessFacts => ({
	pid: 42,
	state: "S",
	processes: 3,
	cpuMs: 1000,
	...overrides,
});

describe("assessProgress", () => {
	it("calls output progress advancing", () => {
		const check = assessProgress(
			{ bytes: 2048, quietMs: 200, bytesSinceLastCheck: 2048 },
			undefined,
			undefined,
			120_000,
		);
		expect(check.verdict).toBe("advancing");
		expect(check.basis).toContain("output");
		expect(check.stalled).toBe(false);
	});

	it("calls CPU progress advancing", () => {
		const check = assessProgress(
			{ bytes: 0, quietMs: 120_000, bytesSinceLastCheck: 0 },
			facts({ cpuMs: 1800 }),
			1000,
			120_000,
		);
		expect(check.verdict).toBe("advancing");
		expect(check.basis).toContain("CPU +800ms");
	});

	it("names the blocking channel when nothing moves in a sleeping tree", () => {
		const check = assessProgress(
			{ bytes: 0, quietMs: 600_000, bytesSinceLastCheck: 0 },
			facts({ cpuMs: 1000, wchan: "futex_wait_queue_me" }),
			1000,
			600_000,
		);
		expect(check.verdict).toBe("blocked");
		expect(check.basis).toContain("futex_wait_queue_me");
		expect(check.stalled).toBe(true);
	});

	it("calls an idle tree without a blocking channel idle", () => {
		const check = assessProgress(
			{ bytes: 0, quietMs: 600_000, bytesSinceLastCheck: 0 },
			facts({ state: "R" }),
			1000,
			600_000,
		);
		expect(check.verdict).toBe("idle");
		expect(check.stalled).toBe(true);
	});

	it("uses cumulative CPU over elapsed time on the first check", () => {
		const check = assessProgress(
			{ bytes: 0, quietMs: undefined, bytesSinceLastCheck: undefined },
			facts({ cpuMs: 120 }),
			undefined,
			120_000,
		);
		expect(check.verdict).toBe("idle");
		expect(check.basis).toContain("over 2m00s elapsed");
	});

	it("reports unknown without output and without process facts", () => {
		const check = assessProgress(
			{ bytes: 0, quietMs: undefined, bytesSinceLastCheck: undefined },
			undefined,
			undefined,
			90_000,
		);
		expect(check.verdict).toBe("unknown");
		expect(check.stalled).toBe(false);
	});
});

describe("formatDuration", () => {
	it("formats milliseconds, seconds, minutes, and hours", () => {
		expect(formatDuration(840)).toBe("840ms");
		expect(formatDuration(12_400)).toBe("12.4s");
		expect(formatDuration(192_000)).toBe("3m12s");
		expect(formatDuration(3_840_000)).toBe("1h04m");
	});
});
