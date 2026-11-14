// issue 工具的单元测试：工具绑死一条 issue，交卷与报卡住各自写对状态。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { IssueStore } from "../src/main/issues/store.ts";
import { createIssueTools } from "../src/main/issues/tools.ts";

function freshStore(): IssueStore {
	return new IssueStore(mkdtempSync(join(tmpdir(), "pi-desktop-issues-tools-")));
}

/** 只走 execute：测试不经过模型，其余字段不看。 */
type Callable = {
	name: string;
	execute: (toolCallId: string, params: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
};

function callable(tools: readonly ToolDefinition[], name: string): Callable {
	const tool = tools.find((entry) => entry.name === name);
	if (!tool) throw new Error(`missing tool ${name}`);
	return tool as unknown as Callable;
}

function setup() {
	const store = freshStore();
	const record = store.create("/w", "fix the thing", "details");
	let changes = 0;
	const tools = createIssueTools(record.id, {
		store,
		onChange: () => {
			changes += 1;
		},
	});
	return { store, record, tools, changes: () => changes };
}

describe("issue tools", () => {
	it("四个工具都在，名字固定", () => {
		const { tools } = setup();
		expect(tools.map((tool) => tool.name)).toEqual(["issue_read", "issue_comment", "issue_finish", "issue_block"]);
	});

	it("issue_read 读的是自己那条，带状态与评论", async () => {
		const { store, record, tools } = setup();
		store.comment(record.id, "user", "note");
		const result = await callable(tools, "issue_read").execute("c1", {});
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("#1 fix the thing");
		expect(text).toContain("Status: open");
		expect(text).toContain("note");
	});

	it("issue_comment 追加一条 agent 记录并通知宿主", async () => {
		const { store, record, tools, changes } = setup();
		await callable(tools, "issue_comment").execute("c1", { text: "halfway" });
		const comments = store.byId(record.id)?.comments ?? [];
		expect(comments.map((entry) => [entry.author, entry.text])).toEqual([["agent", "halfway"]]);
		expect(changes()).toBe(1);
	});

	it("issue_finish 把状态推到 review，并把摘要记成评论", async () => {
		const { store, record, tools } = setup();
		await callable(tools, "issue_finish").execute("c1", { summary: "done, tests pass" });
		const after = store.byId(record.id);
		expect(after?.status).toBe("review");
		expect(after?.error).toBeNull();
		expect(after?.comments.at(-1)?.text).toBe("done, tests pass");
	});

	it("issue_block 回到 open，原因写进 blocked", async () => {
		const { store, record, tools } = setup();
		store.setStatus(record.id, "running");
		await callable(tools, "issue_block").execute("c1", { reason: "need credentials" });
		const after = store.byId(record.id);
		expect(after?.status).toBe("open");
		expect(after?.blocked).toBe("need credentials");
	});

	it("issue 被删掉后工具直接报错，不写任何东西", async () => {
		const { store, record, tools } = setup();
		store.remove(record.id);
		await expect(callable(tools, "issue_finish").execute("c1", { summary: "x" })).rejects.toThrow(/deleted/);
	});
});
