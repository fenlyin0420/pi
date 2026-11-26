/**
 * Process facts of a supervised tool call: which processes it started, what they are doing, and how
 * much CPU they burned, so a suspension can report measured progress instead of guessing.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Processes one call may contain before the walk stops; a bound, not a promise of completeness. */
const MAX_TREE_PROCESSES = 64;

/** Linux reports CPU time in clock ticks of this size, independent of the configured HZ. */
const LINUX_TICKS_PER_SECOND = 100;

export interface ProcessFacts {
	pid: number;
	/** Activity of the tree: "R" running, "D" uninterruptible, "S" sleeping, "Z" zombie, "?" unknown. */
	state: string;
	/** Processes in the tree, including the root. */
	processes: number;
	/** Cumulative user plus system CPU milliseconds of the tree. */
	cpuMs: number;
	/** Kernel wait channel of the root process, for example "futex_wait_queue_me". */
	wchan?: string;
	/** Why this platform or process cannot report facts. */
	unavailable?: string;
}

interface ProcessStat {
	pid: number;
	ppid: number;
	state: string;
	cpuMs: number;
}

/** Sample the process tree rooted at `pid`. Never throws: an unavailable tree returns `unavailable`. */
export async function probeProcessTree(pid: number): Promise<ProcessFacts> {
	if (process.platform === "linux") return probeLinux(pid);
	if (process.platform === "darwin") return probeDarwin(pid);
	return {
		pid,
		state: "?",
		processes: 0,
		cpuMs: 0,
		unavailable: `process facts are not available on ${process.platform}`,
	};
}

async function probeLinux(rootPid: number): Promise<ProcessFacts> {
	const root = await readLinuxStat(rootPid);
	if (!root) return gone(rootPid);
	const tree = [root];
	const queue = [rootPid];
	while (queue.length > 0 && tree.length < MAX_TREE_PROCESSES) {
		const parent = queue.shift() as number;
		for (const childPid of await readLinuxChildren(parent)) {
			const child = await readLinuxStat(childPid);
			if (!child) continue;
			tree.push(child);
			queue.push(childPid);
		}
	}
	return {
		pid: rootPid,
		state: aggregateState(tree),
		processes: tree.length,
		cpuMs: tree.reduce((sum, process_) => sum + process_.cpuMs, 0),
		...(await readLinuxWchan(rootPid)),
	};
}

async function readLinuxStat(pid: number): Promise<ProcessStat | undefined> {
	try {
		const raw = await readFile(`/proc/${pid}/stat`, "utf8");
		// The command name is parenthesized and may contain spaces and parentheses.
		const fields = raw
			.slice(raw.lastIndexOf(")") + 2)
			.trim()
			.split(/\s+/);
		const ppid = Number(fields[1]);
		const utime = Number(fields[11]);
		const stime = Number(fields[12]);
		if (!Number.isFinite(ppid) || !Number.isFinite(utime) || !Number.isFinite(stime)) return undefined;
		return {
			pid,
			ppid,
			state: fields[0] || "?",
			cpuMs: Math.round(((utime + stime) * 1000) / LINUX_TICKS_PER_SECOND),
		};
	} catch {
		return undefined;
	}
}

async function readLinuxChildren(pid: number): Promise<number[]> {
	try {
		const raw = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
		return raw
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map(Number)
			.filter((childPid) => Number.isFinite(childPid));
	} catch {
		return [];
	}
}

async function readLinuxWchan(pid: number): Promise<{ wchan?: string }> {
	try {
		const wchan = (await readFile(`/proc/${pid}/wchan`, "utf8")).trim();
		// "0" means running, an empty file means the kernel hides the channel.
		return wchan && wchan !== "0" ? { wchan } : {};
	} catch {
		return {};
	}
}

async function probeDarwin(rootPid: number): Promise<ProcessFacts> {
	let rows: ProcessStat[];
	try {
		const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,state=,time="]);
		rows = stdout
			.split("\n")
			.map(parseDarwinRow)
			.filter((row): row is ProcessStat => row !== undefined);
	} catch {
		return { pid: rootPid, state: "?", processes: 0, cpuMs: 0, unavailable: "ps did not report process facts" };
	}
	const root = rows.find((row) => row.pid === rootPid);
	if (!root) return gone(rootPid);
	const tree = [root];
	for (let index = 0; index < tree.length && tree.length < MAX_TREE_PROCESSES; index += 1) {
		const parent = tree[index] as ProcessStat;
		for (const row of rows) {
			if (row.ppid === parent.pid && !tree.includes(row)) tree.push(row);
		}
	}
	return {
		pid: rootPid,
		state: aggregateState(tree),
		processes: tree.length,
		cpuMs: tree.reduce((sum, process_) => sum + process_.cpuMs, 0),
	};
}

function parseDarwinRow(line: string): ProcessStat | undefined {
	const [pid, ppid, state, time] = line.trim().split(/\s+/);
	const parsedPid = Number(pid);
	const parsedPpid = Number(ppid);
	const cpuMs = parsePsTime(time);
	if (!Number.isFinite(parsedPid) || !Number.isFinite(parsedPpid) || cpuMs === undefined) return undefined;
	return { pid: parsedPid, ppid: parsedPpid, state: (state ?? "?").charAt(0) || "?", cpuMs };
}

/** Parse a `ps` time field: "MM:SS.ss", "HH:MM:SS", or "D-HH:MM:SS". */
function parsePsTime(text: string | undefined): number | undefined {
	if (!text) return undefined;
	const [daysPart, clockPart] = text.includes("-") ? text.split("-") : [undefined, text];
	const days = daysPart === undefined ? 0 : Number(daysPart);
	const parts = (clockPart ?? "").split(":").map(Number);
	if (!Number.isFinite(days) || parts.some((part) => !Number.isFinite(part))) return undefined;
	const seconds = parts.reduce((total, part) => total * 60 + part, 0);
	return Math.round((days * 86_400 + seconds) * 1000);
}

function aggregateState(tree: ProcessStat[]): string {
	if (tree.some((process_) => process_.state === "R")) return "R";
	if (tree.some((process_) => process_.state === "D")) return "D";
	return tree[0]?.state ?? "?";
}

function gone(pid: number): ProcessFacts {
	return { pid, state: "?", processes: 0, cpuMs: 0, unavailable: "the process exited" };
}
