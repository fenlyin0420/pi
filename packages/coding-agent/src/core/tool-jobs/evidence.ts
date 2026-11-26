/**
 * Turns output activity and process facts into the progress verdict a suspended tool call reports,
 * so the model decides from measurements instead of guessing why a call has not finished.
 */

import { formatSize } from "../tools/truncate.ts";
import type { ProcessFacts } from "./probe.ts";

/** Output activity of the tool under supervision, as reported through its streaming updates. */
export interface OutputActivity {
	/** Total output bytes the tool has reported so far. */
	bytes: number;
	/** Milliseconds since the tool last reported output, undefined when it never did. */
	quietMs: number | undefined;
	/** Bytes reported since the previous check of the same call, undefined on the first check. */
	bytesSinceLastCheck: number | undefined;
}

/** What the measurements say about a call that has outlived its deadline. */
export interface ProgressCheck {
	verdict: "advancing" | "idle" | "blocked" | "unknown";
	/** One line naming the measurements behind the verdict. */
	basis: string;
	/** Whether nothing moved since the previous check, which counts as a no-progress strike. */
	stalled: boolean;
}

/** CPU milliseconds within one check window that count as work, below which the call looks idle. */
const CPU_PROGRESS_MS = 200;

/** Output younger than this counts as progress on the first check, where there is nothing to compare. */
const RECENT_OUTPUT_MS = 5000;

const BLOCKING_CHANNEL = /futex|lock|n_tty_read|pipe_read|wait|poll|select|accept|recv|read/i;

/** Judge whether a supervised call is making progress, and name the measurement that decided it. */
export function assessProgress(
	activity: OutputActivity,
	facts: ProcessFacts | undefined,
	previousCpuMs: number | undefined,
	elapsedMs: number,
): ProgressCheck {
	const cpuDeltaMs = facts && previousCpuMs !== undefined ? Math.max(0, facts.cpuMs - previousCpuMs) : undefined;
	const outputMoved =
		activity.bytesSinceLastCheck !== undefined
			? activity.bytesSinceLastCheck > 0
			: activity.quietMs !== undefined && activity.quietMs <= RECENT_OUTPUT_MS;
	const cpuMoved = cpuDeltaMs !== undefined && cpuDeltaMs >= CPU_PROGRESS_MS;

	if (outputMoved || cpuMoved) {
		const reasons: string[] = [];
		if (outputMoved) reasons.push(`${formatBytes(activity.bytesSinceLastCheck ?? activity.bytes)} of output`);
		if (cpuMoved) reasons.push(`CPU +${formatDuration(cpuDeltaMs ?? 0)}`);
		return { verdict: "advancing", basis: `${reasons.join(", ")} since the last check`, stalled: false };
	}

	if (!facts && activity.quietMs === undefined) {
		return { verdict: "unknown", basis: "no output and no process facts to compare", stalled: false };
	}

	const idleBasis =
		activity.bytesSinceLastCheck === undefined
			? `CPU ${formatDuration(facts?.cpuMs ?? 0)} over ${formatDuration(elapsedMs)} elapsed, no output`
			: `no output, CPU +${formatDuration(cpuDeltaMs ?? 0)} since the last check`;
	if (facts && (facts.state === "S" || facts.state === "D") && facts.wchan && BLOCKING_CHANNEL.test(facts.wchan)) {
		return { verdict: "blocked", basis: `${idleBasis}; waiting in ${facts.wchan}`, stalled: true };
	}
	return { verdict: "idle", basis: idleBasis, stalled: true };
}

function formatBytes(bytes: number): string {
	return bytes === 0 ? "0B" : formatSize(bytes);
}

/** Compact duration for evidence lines: 840ms, 12.4s, 3m12s, 1h4m. */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = Math.round(seconds % 60);
	if (minutes < 60) return `${minutes}m${rest.toString().padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h${(minutes % 60).toString().padStart(2, "0")}m`;
}
