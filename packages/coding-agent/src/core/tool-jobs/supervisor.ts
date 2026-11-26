/**
 * Supervises tool execution: a call that outlives its deadline is suspended into a job that keeps
 * running in the background, and the model decides from the reported evidence whether to wait, kill,
 * or collect the result later.
 */

import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import { assessProgress, formatDuration, type OutputActivity, type ProgressCheck } from "./evidence.ts";
import { type ProcessFacts, probeProcessTree } from "./probe.ts";

export interface ToolSupervisionLimits {
	/** Deadline of one tool call that declares none. */
	softDeadlineMs: number;
	/** Absolute wall-clock limit of one call; 0 disables it. */
	maxWallMs: number;
	/** Concurrently suspended calls; 0 disables suspension. */
	maxJobs: number;
	/** Longest single `job wait`. */
	maxWaitMs: number;
}

export const DEFAULT_TOOL_SUPERVISION_LIMITS: ToolSupervisionLimits = {
	softDeadlineMs: 120_000,
	maxWallMs: 2_700_000,
	maxJobs: 8,
	maxWaitMs: 600_000,
};

/** Consecutive checks without progress after which a suspended call is stopped. */
const STRIKE_LIMIT = 3;

/** How long a kill waits for the call to settle before reporting it as still terminating. */
const KILL_GRACE_MS = 5000;

/** Settled jobs kept readable by `job wait`, `job kill`, and `job output`. */
const KEPT_JOBS = 8;

/** Why the supervisor stopped a call, as reported in its result. */
export type JobKillReason = "model" | "deadline" | "no-progress" | "interrupt";

/** Trailing characters of a result body kept in a settle notice. */
const NOTICE_BODY_CHARS = 2000;

/** Public view of one supervised call. */
export interface SupervisedJob {
	id: string;
	toolCallId: string;
	toolName: string;
	startedAt: number;
	settledAt: number | undefined;
	/** Output bytes the tool reported so far. */
	outputBytes: number;
	lastOutputAt: number | undefined;
	/** Whether the call was suspended at least once. */
	suspended: boolean;
	/** Why the supervisor stopped the call, when it stopped it. */
	killedBy: JobKillReason | undefined;
	result: AgentToolResult<unknown> | undefined;
}

interface Job extends SupervisedJob {
	controller: AbortController;
	promise: Promise<AgentToolResult<unknown>>;
	hardDeadlineAt: number | undefined;
	hardCapTimer: NodeJS.Timeout | undefined;
	/** Bytes and CPU time seen by the previous check, for the next comparison. */
	checkedBytes: number;
	checkedCpuMs: number | undefined;
	/** Whether a previous check recorded a baseline to compare against. */
	hasChecked: boolean;
	strikes: number;
	/** Whether a `job wait` call currently owns this job. */
	waited: boolean;
	pid: number | undefined;
	lastPartial: AgentToolResult<unknown> | undefined;
}

export interface ToolSupervisorOptions {
	/** Called for a job that settles in the background while no `job wait` was attached. */
	onSettled?: (job: SupervisedJob) => void;
	/** Called the first time a call is suspended, so the app can offer the decision surface. */
	onSuspend?: (job: SupervisedJob) => void;
}

/**
 * Runs tool calls under a deadline. A call that outlives its deadline keeps running as a job while
 * the tool result reports measured progress; the model then waits, kills, or reads it.
 */
export class ToolSupervisor {
	private readonly limits: ToolSupervisionLimits;
	private readonly options: ToolSupervisorOptions;
	private readonly running = new Map<string, Job>();
	/** Every in-flight call, suspended or not, so an interrupt can stop all of them. */
	private readonly active = new Map<string, Job>();
	private readonly finished = new Map<string, Job>();
	private nextId = 0;
	private disposed = false;

	constructor(limits: ToolSupervisionLimits, options: ToolSupervisorOptions = {}) {
		this.limits = limits;
		this.options = options;
	}

	/** Jobs that are still running, in start order. */
	listRunning(): SupervisedJob[] {
		return [...this.running.values()].map(snapshot);
	}

	/** Run one tool call, suspending it into a job when it outlives its deadline. */
	async run(
		tool: AgentTool<any>,
		params: unknown,
		toolCallId: string,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<unknown> | undefined,
	): Promise<AgentToolResult<unknown>> {
		if (this.disposed || tool.supervision?.suspendable === false || this.limits.maxJobs <= 0) {
			return tool.execute(toolCallId, params, signal, onUpdate);
		}
		const deadlineMs =
			tool.supervision?.deadlineMs?.(params) ?? tool.supervision?.softDeadlineMs ?? this.limits.softDeadlineMs;
		return this.start(tool, params, toolCallId, signal, onUpdate, deadlineMs);
	}

	/** Attach to a running job for up to `timeoutMs`; a call that outlives it is suspended again. */
	async wait(id: string, timeoutMs: number | undefined, _reason: string): Promise<AgentToolResult<unknown>> {
		const job = this.get(id);
		if (!job) return unknownJob(id, this);
		if (job.settledAt !== undefined) return job.result ?? emptyResult();
		if (job.waited) return errorResult(`Another call is already waiting on ${id}.`);
		job.waited = true;
		try {
			const window = Math.min(timeoutMs ?? this.limits.softDeadlineMs, this.limits.maxWaitMs);
			const outcome = await raceJob(job, window);
			if (outcome === "settled") return job.result ?? emptyResult();
			return await this.suspend(job);
		} finally {
			job.waited = false;
		}
	}

	/** Stop a running job and report what it produced. */
	async kill(id: string, _reason: string): Promise<AgentToolResult<unknown>> {
		const job = this.get(id);
		if (!job) return unknownJob(id, this);
		if (job.settledAt !== undefined) return job.result ?? emptyResult();
		if (job.killedBy === undefined) job.killedBy = "model";
		job.controller.abort();
		const outcome = await raceJob(job, KILL_GRACE_MS);
		if (outcome === "settled") return job.result ?? emptyResult();
		return {
			content: [
				{
					type: "text",
					text: `Kill sent to ${id}, but the call has not finished yet. It is being stopped; check again with job {action:"output", id:"${id}"}.`,
				},
			],
			details: {},
			isError: true,
		};
	}

	/** Read what a running job reported so far, or the result of a settled one. */
	output(id: string): AgentToolResult<unknown> {
		const job = this.get(id);
		if (!job) return unknownJob(id, this);
		if (job.result) return job.result;
		if (!job.lastPartial)
			return { content: [{ type: "text", text: `${id} has produced no output yet.` }], details: {} };
		const quietMs = job.lastOutputAt === undefined ? undefined : Date.now() - job.lastOutputAt;
		const age = quietMs === undefined ? "no output yet" : `last write ${formatDuration(quietMs)} ago`;
		return {
			content: [{ type: "text", text: `Latest output of ${id} (${age}):\n\n${textOf(job.lastPartial)}` }],
			details: job.lastPartial.details,
		};
	}

	/** Stop every running job, for example when the user interrupts the session. */
	killAll(): void {
		for (const job of this.active.values()) {
			if (job.killedBy === undefined) job.killedBy = "interrupt";
			job.controller.abort();
		}
	}

	/** Stop all jobs and ignore everything that settles afterwards. */
	dispose(): void {
		this.killAll();
		this.disposed = true;
		for (const job of this.active.values()) {
			if (job.hardCapTimer) clearTimeout(job.hardCapTimer);
		}
		this.active.clear();
		this.running.clear();
		this.finished.clear();
	}

	private async start(
		tool: AgentTool<any>,
		params: unknown,
		toolCallId: string,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<unknown> | undefined,
		deadlineMs: number,
	): Promise<AgentToolResult<unknown>> {
		const controller = new AbortController();
		const forwardAbort = () => controller.abort();
		if (signal?.aborted) controller.abort();
		else signal?.addEventListener("abort", forwardAbort, { once: true });
		const startedAt = Date.now();
		this.nextId += 1;
		const job: Job = {
			id: `j${this.nextId}`,
			toolCallId,
			toolName: tool.name,
			startedAt,
			settledAt: undefined,
			outputBytes: 0,
			lastOutputAt: undefined,
			suspended: false,
			killedBy: undefined,
			result: undefined,
			controller,
			promise: Promise.resolve(emptyResult()),
			hardDeadlineAt: this.limits.maxWallMs > 0 ? startedAt + this.limits.maxWallMs : undefined,
			hardCapTimer: undefined,
			checkedBytes: 0,
			checkedCpuMs: undefined,
			hasChecked: false,
			strikes: 0,
			waited: false,
			pid: undefined,
			lastPartial: undefined,
		};
		if (this.limits.maxWallMs > 0) {
			job.hardCapTimer = setTimeout(() => {
				if (job.settledAt !== undefined) return;
				if (job.killedBy === undefined) job.killedBy = "deadline";
				controller.abort();
			}, this.limits.maxWallMs);
			job.hardCapTimer.unref();
		}
		job.promise = this.execute(job, tool, params, onUpdate, () => signal?.removeEventListener("abort", forwardAbort));
		this.active.set(job.id, job);
		const outcome = await raceJob(job, deadlineMs);
		return outcome === "settled" ? (job.result ?? emptyResult()) : await this.suspend(job);
	}

	private async execute(
		job: Job,
		tool: AgentTool<any>,
		params: unknown,
		onUpdate: AgentToolUpdateCallback<unknown> | undefined,
		onDone: () => void,
	): Promise<AgentToolResult<unknown>> {
		let result: AgentToolResult<unknown>;
		try {
			result = await tool.execute(job.toolCallId, params, job.controller.signal, (partial) => {
				job.outputBytes = Math.max(job.outputBytes, bytesOf(textOf(partial)));
				job.lastOutputAt = Date.now();
				job.lastPartial = partial;
				const pid = pidOf(partial.details);
				if (pid !== undefined) job.pid = pid;
				onUpdate?.(partial);
			});
		} catch (error) {
			result = errorResult(error instanceof Error ? error.message : String(error), {});
		}
		onDone();
		if (job.hardCapTimer) clearTimeout(job.hardCapTimer);
		job.settledAt = Date.now();
		job.result = this.killNote(job, result);
		this.active.delete(job.id);
		this.running.delete(job.id);
		this.remember(job);
		if (job.suspended && !job.waited && !this.disposed) this.options.onSettled?.(snapshot(job));
		return job.result;
	}

	/**
	 * Suspend a running call: probe what it is doing, record a no-progress strike, and report the
	 * evidence. A call with too many strikes is stopped instead.
	 */
	private async suspend(job: Job): Promise<AgentToolResult<unknown>> {
		if (job.settledAt !== undefined) return job.result ?? emptyResult();
		const otherJobs = [...this.running.keys()].filter((id) => id !== job.id).length;
		if (otherJobs >= this.limits.maxJobs) {
			// No room for another live job: keep waiting, bounded by the hard cap.
			await job.promise;
			return job.result ?? emptyResult();
		}
		this.running.set(job.id, job);
		const firstSuspension = !job.suspended;
		job.suspended = true;
		if (firstSuspension) this.options.onSuspend?.(snapshot(job));
		const now = Date.now();
		const facts = job.pid === undefined ? undefined : await probeProcessTree(job.pid);
		const activity: OutputActivity = {
			bytes: job.outputBytes,
			quietMs: job.lastOutputAt === undefined ? undefined : now - job.lastOutputAt,
			bytesSinceLastCheck: job.hasChecked ? job.outputBytes - job.checkedBytes : undefined,
		};
		const check = assessProgress(activity, facts, job.checkedCpuMs, now - job.startedAt);
		if (check.stalled && job.checkedCpuMs !== undefined) job.strikes += 1;
		job.checkedBytes = job.outputBytes;
		if (facts) job.checkedCpuMs = facts.cpuMs;
		job.hasChecked = true;

		if (job.strikes >= STRIKE_LIMIT) return this.stopStalled(job, check, facts);
		return {
			content: [{ type: "text", text: suspendText(job, check, facts, this) }],
			details: job.lastPartial?.details ?? {},
		};
	}

	private async stopStalled(
		job: Job,
		check: ProgressCheck,
		facts: ProcessFacts | undefined,
	): Promise<AgentToolResult<unknown>> {
		job.killedBy = "no-progress";
		job.controller.abort();
		const outcome = await raceJob(job, KILL_GRACE_MS);
		const summary = `No progress in ${STRIKE_LIMIT} consecutive checks (${check.basis})`;
		if (outcome === "settled") {
			const result = job.result ?? emptyResult();
			return { ...result, content: prepend(`${summary}; the call was stopped.`, result.content), isError: true };
		}
		return {
			content: [
				{
					type: "text",
					text: `${summary}; the call is being stopped.\n\n${evidenceLines(job, check, facts).join("\n")}`,
				},
			],
			details: {},
			isError: true,
		};
	}

	/** Rewrite the result of a call the supervisor stopped, so the model sees why. */
	private killNote(job: Job, result: AgentToolResult<unknown>): AgentToolResult<unknown> {
		if (job.killedBy === undefined) return result;
		const elapsed = formatDuration((job.settledAt ?? Date.now()) - job.startedAt);
		return {
			...result,
			content: prepend(`${killReasonText(job.killedBy, this.limits.maxWallMs)} after ${elapsed}.`, result.content),
			isError: true,
		};
	}

	private remember(job: Job): void {
		this.finished.delete(job.id);
		this.finished.set(job.id, job);
		while (this.finished.size > KEPT_JOBS) {
			const oldest = this.finished.keys().next();
			if (oldest.done) break;
			this.finished.delete(oldest.value);
		}
	}

	private get(id: string): Job | undefined {
		return this.running.get(id) ?? this.finished.get(id);
	}
}

/** Why a stopped call was stopped, for its result and its settle notice. */
function killReasonText(reason: JobKillReason, maxWallMs: number): string {
	const reasons: Record<JobKillReason, string> = {
		deadline: `Stopped at the ${formatDuration(maxWallMs)} wall-clock limit`,
		model: "Stopped at your request",
		interrupt: "Stopped because the session was interrupted",
		"no-progress": "Stopped after no progress",
	};
	return reasons[reason];
}

/** Wait for a job for at most `windowMs`; resolves "window" when the window closes first. */
function raceJob(job: Job, windowMs: number): Promise<"settled" | "window"> {
	return new Promise((resolve) => {
		let timer: NodeJS.Timeout | undefined = setTimeout(
			() => {
				timer = undefined;
				resolve("window");
			},
			Math.max(0, windowMs),
		);
		void job.promise.then(() => {
			if (timer) clearTimeout(timer);
			timer = undefined;
			resolve("settled");
		});
	});
}

/** The text a suspended tool call returns: what is still running, what it is doing, what to do next. */
function suspendText(
	job: Job,
	check: ProgressCheck,
	facts: ProcessFacts | undefined,
	supervisor: ToolSupervisor,
): string {
	const elapsed = formatDuration(Date.now() - job.startedAt);
	const header = `Tool ${job.toolName} is still running after ${elapsed} and was suspended as job ${job.id}. It keeps running.`;
	const limits: string[] = [];
	if (job.hardDeadlineAt !== undefined) {
		limits.push(
			`${formatDuration(Math.max(0, job.hardDeadlineAt - Date.now()))} left before the wall-clock limit stops it`,
		);
	}
	const others = supervisor.listRunning().filter((running) => running.id !== job.id);
	limits.push(
		others.length === 0
			? "no other job is running"
			: `${others.length} other job(s) running: ${others.map((running) => running.id).join(", ")}`,
	);
	return [
		header,
		...evidenceLines(job, check, facts),
		`Limits: ${limits.join("; ")}.`,
		`Next: job {action:"wait", id:"${job.id}", timeout:<seconds>, reason:"<the evidence you acted on>"} keeps waiting; {action:"kill"} stops it; {action:"output"} reads what it wrote. Continuing other work is also fine: the result arrives when it finishes.`,
	].join("\n");
}

function evidenceLines(job: Job, check: ProgressCheck, facts: ProcessFacts | undefined): string[] {
	const quietMs = job.lastOutputAt === undefined ? undefined : Date.now() - job.lastOutputAt;
	const lines = [
		quietMs === undefined
			? `Output: none yet (${formatBytes(job.outputBytes)}).`
			: `Output: ${formatBytes(job.outputBytes)} total, last write ${formatDuration(quietMs)} ago.`,
	];
	if (facts && !facts.unavailable) {
		lines.push(
			`Process: ${facts.processes} process(es), state ${facts.state}, CPU ${formatDuration(facts.cpuMs)} total${facts.wchan ? `, waiting in ${facts.wchan}` : ""}.`,
		);
	} else if (facts?.unavailable) {
		lines.push(`Process: unknown (${facts.unavailable}).`);
	}
	lines.push(`Assessment: ${check.verdict} — ${check.basis}.`);
	return lines;
}

function snapshot(job: Job): SupervisedJob {
	return {
		id: job.id,
		toolCallId: job.toolCallId,
		toolName: job.toolName,
		startedAt: job.startedAt,
		settledAt: job.settledAt,
		outputBytes: job.outputBytes,
		lastOutputAt: job.lastOutputAt,
		suspended: job.suspended,
		killedBy: job.killedBy,
		result: job.result,
	};
}

function unknownJob(id: string, supervisor: ToolSupervisor): AgentToolResult<unknown> {
	const known = supervisor.listRunning().map((job) => job.id);
	return errorResult(
		`No job ${id}.${known.length > 0 ? ` Running jobs: ${known.join(", ")}.` : " No job is running."}`,
		{},
	);
}

/**
 * The message a job that finished in the background leaves for the next turn: what ran, what it
 * cost, and the tail of its result so most follow-ups need no extra tool call.
 */
export function jobSettledNotice(job: SupervisedJob): string {
	const elapsed = formatDuration((job.settledAt ?? Date.now()) - job.startedAt);
	const status =
		job.killedBy === undefined ? (job.result?.isError ? "failed" : "finished") : `was stopped (${job.killedBy})`;
	const body = job.result ? textOf(job.result) : "";
	const tail = body.length > NOTICE_BODY_CHARS ? `[...]${body.slice(-NOTICE_BODY_CHARS)}` : body;
	return [
		`[job ${job.id}] ${job.toolName} ${status} after ${elapsed}.`,
		`Read the full result with job {action:"output", id:"${job.id}"}.`,
		tail ? `\n${tail}` : "",
	]
		.filter((line) => line !== "")
		.join("\n");
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0B";
	if (bytes < 1024) return `${bytes}B`;
	return `${Math.round((bytes / 1024) * 10) / 10}KB`;
}

function textOf(result: AgentToolResult<unknown>): string {
	return result.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") ?? "";
}

function bytesOf(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function pidOf(details: unknown): number | undefined {
	if (!details || typeof details !== "object" || !("pid" in details)) return undefined;
	const pid = (details as { pid?: unknown }).pid;
	return typeof pid === "number" && Number.isFinite(pid) ? pid : undefined;
}

function prepend(
	note: string,
	content: AgentToolResult<unknown>["content"] | undefined,
): AgentToolResult<unknown>["content"] {
	return [{ type: "text", text: `${note}\n\n` }, ...(content ?? [])];
}

function emptyResult(): AgentToolResult<unknown> {
	return { content: [], details: {} };
}

function errorResult(message: string, details: unknown = {}): AgentToolResult<unknown> {
	return { content: [{ type: "text", text: message }], details, isError: true };
}
