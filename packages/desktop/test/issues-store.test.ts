// IssueStore 的单元测试：编号、状态迁移、坏记录丢弃、重启后 running 回队列。

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IssueStore } from "../src/main/issues/store.ts";

function issuesDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-desktop-issues-"));
}

function storeFrom(payload: unknown): IssueStore {
	const directory = issuesDir();
	writeFileSync(join(directory, "issues.json"), JSON.stringify(payload), "utf8");
	return new IssueStore(directory);
}

function flushed(store: IssueStore): unknown {
	store.flush();
	return readFileSync((store as unknown as { file: string }).file, "utf8");
}

describe("IssueStore", () => {
	it("编号按 workspace 各自自增，不受别的 workspace 影响", () => {
		const store = new IssueStore(issuesDir());
		expect(store.create("D:\\a", "one", "").number).toBe(1);
		expect(store.create("D:\\a", "two", "").number).toBe(2);
		expect(store.create("D:\\b", "other", "").number).toBe(1);
	});

	it("新建的 issue 从 open 开始，正文和标题被裁到上限", () => {
		const store = new IssueStore(issuesDir());
		const record = store.create("/w", `  ${"t".repeat(300)}  `, "b".repeat(30_000));
		expect(record.status).toBe("open");
		expect(record.title.length).toBe(200);
		expect(record.body.length).toBe(20_000);
		expect(record.sessionId).toBeNull();
	});

	it("状态迁移保留 blocked 与 error 以外的字段，并把 updatedAt 推进", () => {
		const store = new IssueStore(issuesDir());
		const created = store.create("/w", "fix", "body");
		const moved = store.setStatus(created.id, "queued", { error: null, blocked: null });
		expect(moved?.status).toBe("queued");
		expect(moved?.number).toBe(created.number);
		expect(moved?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
	});

	it("评论按顺序追加，空文本被忽略", () => {
		const store = new IssueStore(issuesDir());
		const created = store.create("/w", "fix", "");
		store.comment(created.id, "user", "  ");
		store.comment(created.id, "user", "first");
		store.comment(created.id, "agent", "second");
		expect(store.byId(created.id)?.comments.map((entry) => entry.text)).toEqual(["first", "second"]);
	});

	it("会话可以按 sessionId 反查，也能被放开", () => {
		const store = new IssueStore(issuesDir());
		const created = store.create("/w", "fix", "");
		store.attachSession(created.id, "s1");
		expect(store.bySession("s1")?.id).toBe(created.id);
		store.detachSession("s1");
		expect(store.bySession("s1")).toBeUndefined();
		expect(store.byId(created.id)?.sessionId).toBeNull();
	});

	it("删除后不回收编号", () => {
		const store = new IssueStore(issuesDir());
		const first = store.create("/w", "one", "");
		store.remove(first.id);
		expect(store.create("/w", "two", "").number).toBe(2);
		expect(store.list()).toHaveLength(1);
	});

	it("坏记录逐条丢弃，好的照旧读出来", () => {
		const store = storeFrom({
			version: 1,
			issues: [
				{ id: "a", number: 1, workspace: "/w", title: "ok", status: "open" },
				{ id: "b", number: 2, workspace: "/w", title: "bad status", status: "nope" },
				"junk",
			],
		});
		expect(store.list().map((record) => record.id)).toEqual(["a"]);
	});

	it("重启时 running 回到 queued，并写明原因", () => {
		const store = storeFrom({
			version: 1,
			issues: [{ id: "a", number: 1, workspace: "/w", title: "t", status: "running" }],
		});
		const record = store.byId("a");
		expect(record?.status).toBe("queued");
		expect(record?.error).toBe("Interrupted when the app exited");
	});

	it("编号计数器落盘，重载后接着往下发", () => {
		const directory = issuesDir();
		const store = new IssueStore(directory);
		store.create("/w", "one", "");
		store.flush();
		expect(new IssueStore(directory).create("/w", "two", "").number).toBe(2);
	});

	it("写盘是带 version 的完整文件", () => {
		const store = new IssueStore(issuesDir());
		store.create("/w", "one", "");
		const payload = JSON.parse(String(flushed(store))) as { version: number; issues: unknown[] };
		expect(payload.version).toBe(1);
		expect(payload.issues).toHaveLength(1);
	});
});
