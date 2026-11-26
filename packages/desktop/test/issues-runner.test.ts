// 并行推进器的单元测试：顺序、并发上限、交卷、卡住、失败停机和用户停止。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IssueRunner, type IssueRunnerPorts } from "../src/main/issues/runner.ts";
import { IssueStore } from "../src/main/issues/store.ts";

function freshStore(): IssueStore {
	return new IssueStore(mkdtempSync(join(tmpdir(), "pi-desktop-issues-runner-")));
}

function queued(store: IssueStore, title: string): string {
	const record = store.create("/w", title, `body of ${title}`);
	store.setStatus(record.id, "queued");
	return record.id;
}

/** 只记录调用的端口；prompt 立刻返回，等于模型跑完一轮而没交卷。 */
function recordingPorts(store: IssueStore, concurrency = 1) {
	const prompts: { sessionId: string; text: string }[] = [];
	const aborted: string[] = [];
	const notices: string[] = [];
	const ports: IssueRunnerPorts = {
		ensureSession: async (issue) => `session-${issue.number}`,
		prompt: async (sessionId, text) => {
			prompts.push({ sessionId, text });
			void store;
		},
		abort: async (sessionId) => {
			aborted.push(sessionId);
		},
		notify: (_level, message) => notices.push(message),
		changed: () => {},
		concurrency: () => concurrency,
	};
	return { ports, prompts, aborted, notices };
}

describe("IssueRunner", () => {
	it("并发度 1 时一条接一条，按先来后到", async () => {
		const store = freshStore();
		const first = queued(store, "one");
		const second = queued(store, "two");
		const { ports, prompts } = recordingPorts(store);

		await new IssueRunner(store, ports).start();

		expect(prompts).toHaveLength(2);
		expect(prompts[0]?.text).toContain("Resolve issue #1 in this workspace.");
		expect(prompts[0]?.text).toContain("## one");
		expect(prompts[1]?.text).toContain("## two");
		// 模型没交卷：两条都进 review，等人工看。
		expect(store.byId(first)?.status).toBe("review");
		expect(store.byId(first)?.error).toBe("The agent finished without calling issue_finish");
		expect(store.byId(second)?.status).toBe("review");
	});

	it("并发度 N 时同时起跑 N 条，跑完一条补一条", async () => {
		const store = freshStore();
		for (const title of ["one", "two", "three", "four"]) queued(store, title);
		const started: string[] = [];
		const releases: Array<() => void> = [];
		let peak = 0;
		let active = 0;
		const runner = new IssueRunner(store, {
			ensureSession: async (issue) => `session-${issue.number}`,
			prompt: async (sessionId) => {
				active += 1;
				peak = Math.max(peak, active);
				started.push(sessionId);
				await new Promise<void>((resolve) => {
					releases.push(() => {
						active -= 1;
						resolve();
					});
				});
			},
			abort: async () => {},
			notify: () => {},
			changed: () => {},
			concurrency: () => 3,
		});

		const done = runner.start();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(started).toHaveLength(3);
		expect(runner.view().running).toHaveLength(3);
		// 放掉一条，队列里第 4 条补上。
		releases[0]?.();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(started).toHaveLength(4);
		for (const release of releases) release();
		await done;
		expect(peak).toBe(3);
		expect(runner.view()).toEqual({ running: [], pending: 0, paused: false });
	});

	it("跑之前记下线程会话与 lastRunAt", async () => {
		const store = freshStore();
		const id = queued(store, "one");
		const { ports } = recordingPorts(store);
		await new IssueRunner(store, ports).start();
		const record = store.byId(id);
		expect(record?.sessionId).toBe("session-1");
		expect(record?.lastRunAt).not.toBeNull();
	});

	it("工具交了卷就保留 review，不再覆盖成失败", async () => {
		const store = freshStore();
		const id = queued(store, "one");
		const runner = new IssueRunner(store, {
			ensureSession: async () => "s1",
			prompt: async () => {
				store.setStatus(id, "review", { error: null });
			},
			abort: async () => {},
			notify: () => {},
			changed: () => {},
			concurrency: () => 1,
		});

		await runner.start();

		expect(store.byId(id)?.status).toBe("review");
		expect(store.byId(id)?.error).toBeNull();
	});

	it("模型报卡住时回到 open 并接着跑下一条", async () => {
		const store = freshStore();
		const blocked = queued(store, "blocked");
		const next = queued(store, "next");
		const ran: string[] = [];
		const runner = new IssueRunner(store, {
			ensureSession: async (issue) => `session-${issue.number}`,
			prompt: async () => {
				ran.push(store.list().find((record) => record.status === "running")?.title ?? "");
				store.setStatus(blocked, "open", { blocked: "need a decision" });
			},
			abort: async () => {},
			notify: () => {},
			changed: () => {},
			concurrency: () => 1,
		});

		await runner.start();

		expect(ran).toEqual(["blocked", "next"]);
		expect(store.byId(blocked)?.blocked).toBe("need a decision");
		expect(store.byId(next)?.status).toBe("review");
	});

	it("一轮失败就退回 queued、不再开新的并报出来", async () => {
		const store = freshStore();
		const first = queued(store, "one");
		const second = queued(store, "two");
		const notices: string[] = [];
		const runner = new IssueRunner(store, {
			ensureSession: async () => "s1",
			prompt: async () => {
				throw new Error("no credentials");
			},
			abort: async () => {},
			notify: (_level, message) => notices.push(message),
			changed: () => {},
			concurrency: () => 1,
		});

		await runner.start();

		expect(store.byId(first)?.status).toBe("queued");
		expect(store.byId(first)?.error).toBe("no credentials");
		// 失败即停机：第二条不会被拉起来。
		expect(store.byId(second)?.status).toBe("queued");
		expect(runner.view().paused).toBe(true);
		expect(notices[0]).toContain("no credentials");
	});

	it("用户停止：打断所有在跑的轮次，每条回队列并写明原因", async () => {
		const store = freshStore();
		const first = queued(store, "one");
		const second = queued(store, "two");
		const releases = new Map<string, () => void>();
		const aborted: string[] = [];
		const runner = new IssueRunner(store, {
			ensureSession: async (issue) => `session-${issue.number}`,
			prompt: (sessionId) =>
				new Promise<void>((resolve) => {
					releases.set(sessionId, resolve);
				}),
			abort: async (sessionId) => {
				aborted.push(sessionId);
				releases.get(sessionId)?.();
			},
			notify: () => {},
			changed: () => {},
			concurrency: () => 2,
		});

		const done = runner.start();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await runner.stop();
		await done;

		expect(aborted.sort()).toEqual(["session-1", "session-2"]);
		expect(store.byId(first)?.status).toBe("queued");
		expect(store.byId(first)?.error).toBe("Stopped by the user");
		expect(store.byId(second)?.status).toBe("queued");
	});

	it("暂停：在跑的那几条跑完就停，队列留在 queued", async () => {
		const store = freshStore();
		const first = queued(store, "one");
		const second = queued(store, "two");
		const third = queued(store, "three");
		const prompts: string[] = [];
		let runner: IssueRunner | null = null;
		runner = new IssueRunner(store, {
			ensureSession: async (issue) => `session-${issue.number}`,
			prompt: async () => {
				prompts.push("x");
				runner?.pause();
			},
			abort: async () => {},
			notify: () => {},
			changed: () => {},
			concurrency: () => 1,
		});

		await runner.start();

		expect(prompts).toHaveLength(1);
		expect(store.byId(first)?.status).toBe("review");
		expect(store.byId(second)?.status).toBe("queued");
		expect(store.byId(third)?.status).toBe("queued");
	});
});
