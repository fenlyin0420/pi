// issues 的运行队列：最多并行 N 条（1–5，可设置），跑完等用户关闭，重启后从 queued 接着来。

import type { IssueRunView } from "../../shared/contract.ts";
import { runPrompt } from "./prompt.ts";
import type { IssueRecord, IssueStore } from "./store.ts";

const STOPPED = "Stopped by the user";

export type IssueRunnerPorts = {
	/** 拿到这条 issue 的线程会话：没有就新建，有就复用。 */
	ensureSession(issue: IssueRecord): Promise<string>;
	/** 跑一轮；这一轮结束才 resolve。 */
	prompt(sessionId: string, text: string): Promise<void>;
	abort(sessionId: string): Promise<void>;
	notify(level: "info" | "warning" | "error", message: string): void;
	/** 状态或队列变了：宿主重推快照。 */
	changed(): void;
	/** 同时跑几条。每次补位都重读一次，设置改了当场生效。 */
	concurrency(): number;
};

/**
 * 并行推进器。上限由设置给（1–5），每条 issue 有自己的线程会话。
 * 暂停与停止只影响“还开不开新的”与“在跑的要不要打断”，互不等待。
 */
export class IssueRunner {
	private readonly store: IssueStore;
	private readonly ports: IssueRunnerPorts;
	/** 在跑的 issue id 到它那一轮的承诺；并发度就是它的长度。 */
	private readonly active = new Map<string, Promise<void>>();
	/** 被 stop 打断的 issue：它们回 queued 而不是 review。 */
	private readonly halted = new Set<string>();
	private paused = false;
	/** start() 的等待者：队列跑空或被停/暂停时结束。 */
	private idleResolve: (() => void) | null = null;

	constructor(store: IssueStore, ports: IssueRunnerPorts) {
		this.store = store;
		this.ports = ports;
	}

	view(): IssueRunView {
		const pending = this.store.list().filter((record) => record.status === "queued").length;
		return { running: [...this.active.keys()], pending, paused: this.paused };
	}

	/** 开始（或继续）推进；返回的承诺在队列停下后结束，测试靠它等结果。 */
	start(): Promise<void> {
		this.paused = false;
		this.ports.changed();
		const idle = new Promise<void>((resolve) => {
			this.idleResolve = resolve;
		});
		this.pump();
		return idle;
	}

	/** 暂停：在跑的那几条跑完就停，队列留在 queued。 */
	pause(): void {
		this.paused = true;
		this.ports.changed();
		this.resolveIdle();
	}

	/** 停止：打断所有在跑的轮次，被打断的那条回队列，等下次开始再跑。 */
	async stop(): Promise<void> {
		this.paused = true;
		const ids = [...this.active.keys()];
		for (const id of ids) this.halted.add(id);
		this.ports.changed();
		await Promise.all(ids.map((id) => this.abortIssue(id)));
		this.resolveIdle();
	}

	private async abortIssue(id: string): Promise<void> {
		const sessionId = this.store.byId(id)?.sessionId;
		if (!sessionId) return;
		await this.ports.abort(sessionId);
	}

	/** 补位：有空位就取下一条排队项。每条 run 结束时回来再补一次。 */
	private pump(): void {
		const limit = this.ports.concurrency();
		while (!this.paused && this.active.size < limit) {
			const next = this.nextQueued();
			if (!next) break;
			this.launch(next);
		}
		this.resolveIdle();
	}

	private launch(issue: IssueRecord): void {
		const task = this.run(issue).finally(() => {
			this.active.delete(issue.id);
			this.ports.changed();
			this.pump();
		});
		this.active.set(issue.id, task);
	}

	/** 没有在跑、也没有可跑的就结束等待。暂停时不等，停下就是结果。 */
	private resolveIdle(): void {
		const resolve = this.idleResolve;
		if (!resolve) return;
		if (this.active.size > 0) return;
		if (!this.paused && this.nextQueued()) return;
		this.idleResolve = null;
		resolve();
	}

	private nextQueued(): IssueRecord | undefined {
		const queued = this.store.list().filter((record) => record.status === "queued");
		queued.sort((a, b) => a.createdAt - b.createdAt || a.number - b.number);
		return queued[0];
	}

	private async run(issue: IssueRecord): Promise<void> {
		// 提示要在 markRun 之前组装：lastRunAt 一改，“上次运行后新增的评论”就变成空集了。
		const text = runPrompt(issue);
		this.store.setStatus(issue.id, "running", { blocked: null, error: null });
		this.store.markRun(issue.id, Date.now());
		this.ports.changed();
		try {
			const sessionId = await this.ports.ensureSession(issue);
			this.store.attachSession(issue.id, sessionId);
			this.ports.changed();
			// 停止可能在开会话的时候按下来：此时还没起跑，直接退回队列。
			if (this.halted.delete(issue.id)) {
				this.store.setStatus(issue.id, "queued", { error: STOPPED });
				return;
			}
			await this.ports.prompt(sessionId, text);
			this.settle(issue.id);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stopped = this.halted.delete(issue.id);
			this.store.setStatus(issue.id, "queued", { error: stopped ? STOPPED : message });
			if (!stopped) {
				// 一次失败就停机：模型不可用、额度耗尽这类空转重试没有意义。
				// 已经在跑的那几条让它跑完，用户看完错误再决定要不要继续。
				this.paused = true;
				this.ports.notify("error", `Issue #${issue.number} failed: ${message}`);
			}
		} finally {
			this.halted.delete(issue.id);
			this.ports.changed();
		}
	}

	/**
	 * 一轮结束后的收尾。工具已经把状态写成 review 或 open 时什么都不做；
	 * 还是 running 说明模型没交卷——进 review 让人看，而不是悄悄算完成。
	 */
	private settle(id: string): void {
		const record = this.store.byId(id);
		if (!record || record.status !== "running") return;
		if (this.halted.has(id)) {
			this.store.setStatus(id, "queued", { error: STOPPED });
			return;
		}
		this.store.setStatus(id, "review", { error: "The agent finished without calling issue_finish" });
	}
}
