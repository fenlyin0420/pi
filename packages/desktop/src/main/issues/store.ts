// 实验性 issues 的持久化：issues.json 落在 Electron userData 下，main 进程是唯一写者。
// 读盘时逐字段校验，坏记录丢弃而不是让整份文件失效；写盘去抖并原子替换。

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IssueComment, IssueStatus } from "../../shared/contract.ts";

/** 一条 issue 的磁盘形状；界面看到的摘要与详情由 view.ts 从这里投影。 */
export type IssueRecord = {
	id: string;
	/** 按 workspace 自增的编号，即界面上的 #12。 */
	number: number;
	workspace: string;
	title: string;
	body: string;
	status: IssueStatus;
	createdAt: number;
	updatedAt: number;
	/** 线程会话；第一次运行时创建，用户删掉会话后会被换成新的一条。 */
	sessionId: string | null;
	/** 上一次开始运行的时刻：把“上次运行之后用户补充的内容”从评论里挑出来。 */
	lastRunAt: number | null;
	blocked: string | null;
	error: string | null;
	comments: IssueComment[];
};

const FILE_VERSION = 1;
const WRITE_DELAY_MS = 250;
const TITLE_LIMIT = 200;
const BODY_LIMIT = 20_000;
const COMMENT_LIMIT = 8_000;
const COMMENTS_MAX = 200;
const ISSUES_MAX = 500;
const STATUSES: readonly IssueStatus[] = ["open", "queued", "running", "review", "closed"];

/** 运行中的 issue 在重启后不可能还在跑：落回队列，并记下为什么。 */
const INTERRUPTED = "Interrupted when the app exited";

type PersistedFile = {
	version: number;
	issues: IssueRecord[];
	/** 每个 workspace 已经发出去的最大编号；删除不回收，避免两条 issue 同号。 */
	counters: Record<string, number>;
};

/**
 * 一个 JSON 文件持有全部 workspace 的 issue。读盘是第一道信任边界（用户手改或旧版本文件），
 * 写入沿用 settings.json 的做法：临时文件加 rename，250ms 去抖。
 */
export class IssueStore {
	private readonly file: string;
	private records: IssueRecord[];
	private counters: Map<string, number>;
	private timer: NodeJS.Timeout | null = null;

	constructor(directory: string) {
		mkdirSync(directory, { recursive: true });
		this.file = join(directory, "issues.json");
		const loaded = readIssuesFile(this.file);
		this.records = loaded.issues;
		this.counters = loaded.counters;
		if (loaded.recovered) this.scheduleWrite();
	}

	/** 全部 issue，编号从大到小。 */
	list(): readonly IssueRecord[] {
		return [...this.records].sort((a, b) => b.number - a.number);
	}

	byId(id: string): IssueRecord | undefined {
		return this.records.find((record) => record.id === id);
	}

	/** 线程会话反查它属于哪条 issue：会话开着时决定要不要挂 issue 工具。 */
	bySession(sessionId: string): IssueRecord | undefined {
		return this.records.find((record) => record.sessionId === sessionId);
	}

	create(workspace: string, title: string, body: string): IssueRecord {
		const number = (this.counters.get(workspace) ?? 0) + 1;
		this.counters.set(workspace, number);
		const now = Date.now();
		const record: IssueRecord = {
			id: randomUUID(),
			number,
			workspace,
			title: clip(title.trim(), TITLE_LIMIT),
			body: clip(body, BODY_LIMIT),
			status: "open",
			createdAt: now,
			updatedAt: now,
			sessionId: null,
			lastRunAt: null,
			blocked: null,
			error: null,
			comments: [],
		};
		// 超出上限时丢最老的 closed，再不行丢最老的：只留最近的，不让文件无限长。
		if (this.records.length >= ISSUES_MAX) this.records = this.evict(this.records);
		this.records = [...this.records, record];
		this.scheduleWrite();
		return record;
	}

	update(id: string, patch: { title?: string; body?: string }): IssueRecord | undefined {
		return this.replace(id, (record) => ({
			...record,
			...(patch.title === undefined ? {} : { title: clip(patch.title.trim(), TITLE_LIMIT) }),
			...(patch.body === undefined ? {} : { body: clip(patch.body, BODY_LIMIT) }),
		}));
	}

	setStatus(
		id: string,
		status: IssueStatus,
		patch: { blocked?: string | null; error?: string | null } = {},
	): IssueRecord | undefined {
		return this.replace(id, (record) => ({
			...record,
			status,
			blocked: patch.blocked === undefined ? record.blocked : patch.blocked,
			error: patch.error === undefined ? record.error : patch.error,
		}));
	}

	markRun(id: string, at: number): IssueRecord | undefined {
		return this.replace(id, (record) => ({ ...record, lastRunAt: at }));
	}

	attachSession(id: string, sessionId: string): IssueRecord | undefined {
		return this.replace(id, (record) => ({ ...record, sessionId }));
	}

	/** 追加一条记录：用户补充、agent 的进度或交卷摘要。超上限丢最老的一条。 */
	comment(id: string, author: IssueComment["author"], text: string): IssueRecord | undefined {
		const trimmed = text.trim();
		if (!trimmed) return undefined;
		return this.replace(id, (record) => ({
			...record,
			comments: [...record.comments, { at: Date.now(), author, text: clip(trimmed, COMMENT_LIMIT) }].slice(
				-COMMENTS_MAX,
			),
		}));
	}

	remove(id: string): void {
		const next = this.records.filter((record) => record.id !== id);
		if (next.length === this.records.length) return;
		this.records = next;
		this.scheduleWrite();
	}

	/** 删除一条 issue 的会话引用：用户删掉了那个会话，线程留空等下次运行重建。 */
	detachSession(sessionId: string): void {
		const record = this.bySession(sessionId);
		if (!record) return;
		this.replace(record.id, (current) => ({ ...current, sessionId: null }));
	}

	flush(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.write();
	}

	private replace(id: string, change: (record: IssueRecord) => IssueRecord): IssueRecord | undefined {
		const index = this.records.findIndex((record) => record.id === id);
		if (index < 0) return undefined;
		const next = { ...change(this.records[index]), updatedAt: Date.now() };
		this.records = this.records.map((record, position) => (position === index ? next : record));
		this.scheduleWrite();
		return next;
	}

	private evict(records: readonly IssueRecord[]): IssueRecord[] {
		const oldestClosed = records.find((record) => record.status === "closed") ?? records[0];
		return records.filter((record) => record !== oldestClosed);
	}

	private scheduleWrite(): void {
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			this.write();
		}, WRITE_DELAY_MS);
	}

	private write(): void {
		const payload: PersistedFile = {
			version: FILE_VERSION,
			issues: this.records,
			counters: Object.fromEntries(this.counters),
		};
		const temporary = `${this.file}.tmp`;
		try {
			writeFileSync(temporary, `${JSON.stringify(payload, null, "\t")}\n`, "utf8");
			renameSync(temporary, this.file);
		} catch (error) {
			console.error("[desktop] issues write failed", error);
		}
	}
}

function readIssuesFile(file: string): {
	issues: IssueRecord[];
	counters: Map<string, number>;
	recovered: boolean;
} {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return { issues: [], counters: new Map(), recovered: false };
	}
	if (!isRecord(raw)) return { issues: [], counters: new Map(), recovered: false };
	const issues: IssueRecord[] = [];
	let recovered = false;
	for (const entry of Array.isArray(raw.issues) ? raw.issues : []) {
		const record = toRecord(entry);
		if (!record) continue;
		if (record.status === "running") {
			record.status = "queued";
			record.error = INTERRUPTED;
			recovered = true;
		}
		issues.push(record);
	}
	// 编号以数据为准：手改过文件、或旧文件里没有 counters 时，编号仍从下一条接上。
	const counters = new Map<string, number>();
	for (const [workspace, value] of Object.entries(isRecord(raw.counters) ? raw.counters : {})) {
		if (typeof value === "number" && Number.isFinite(value)) counters.set(workspace, Math.floor(value));
	}
	for (const record of issues) {
		counters.set(record.workspace, Math.max(counters.get(record.workspace) ?? 0, record.number));
	}
	return { issues: issues.slice(-ISSUES_MAX), counters, recovered };
}

/** 逐字段校验一条记录；必填项缺失或类型不对就整条丢弃，不猜半条 issue 出来。 */
function toRecord(raw: unknown): IssueRecord | null {
	if (!isRecord(raw)) return null;
	const { id, workspace, title } = raw;
	if (typeof id !== "string" || id === "") return null;
	if (typeof workspace !== "string" || workspace === "") return null;
	if (typeof title !== "string") return null;
	if (typeof raw.number !== "number" || !Number.isFinite(raw.number)) return null;
	const status = STATUSES.find((candidate) => candidate === raw.status);
	if (!status) return null;
	const comments: IssueComment[] = [];
	for (const entry of Array.isArray(raw.comments) ? raw.comments : []) {
		if (!isRecord(entry)) continue;
		if (typeof entry.text !== "string" || typeof entry.at !== "number") continue;
		comments.push({
			at: entry.at,
			author: entry.author === "agent" ? "agent" : "user",
			text: clip(entry.text, COMMENT_LIMIT),
		});
	}
	const now = Date.now();
	return {
		id,
		number: Math.floor(raw.number),
		workspace,
		title: clip(title, TITLE_LIMIT),
		body: typeof raw.body === "string" ? clip(raw.body, BODY_LIMIT) : "",
		status,
		createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
		updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
		sessionId: typeof raw.sessionId === "string" && raw.sessionId !== "" ? raw.sessionId : null,
		lastRunAt: typeof raw.lastRunAt === "number" ? raw.lastRunAt : null,
		blocked: typeof raw.blocked === "string" && raw.blocked !== "" ? clip(raw.blocked, COMMENT_LIMIT) : null,
		error: typeof raw.error === "string" && raw.error !== "" ? clip(raw.error, COMMENT_LIMIT) : null,
		comments: comments.slice(-COMMENTS_MAX),
	};
}

function clip(text: string, limit: number): string {
	return text.length > limit ? text.slice(0, limit) : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
