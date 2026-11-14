// issue 线程会话专属的四个工具：读自己那一条 issue、补充记录、交卷或报卡住。
// 工具闭包绑死一条 issue，模型没有别的 issue 的入口。

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { IssueStore } from "./store.ts";

/** 一次读回多少条评论：够看清上次停在哪，又不至于把整条历史灌进上下文。 */
const COMMENT_READ_LIMIT = 20;

export type IssueToolDeps = {
	store: IssueStore;
	/** 状态或评论变了：宿主据此重推快照。 */
	onChange(): void;
};

const readSchema = Type.Object({});
const commentSchema = Type.Object({
	text: Type.String({ description: "What to record; one or two sentences", maxLength: 8_000 }),
});
const finishSchema = Type.Object({
	summary: Type.String({
		description: "What you changed and how it can be verified; one short paragraph",
		maxLength: 8_000,
	}),
});
const blockSchema = Type.Object({
	reason: Type.String({ description: "Exactly what you need from the user", maxLength: 8_000 }),
});

/**
 * 给一条 issue 的线程会话造工具。开关与推进都由桌面端自己的 runner 负责，
 * 模型这边只做三件事：看、记、交卷（或报卡住）。
 */
export function createIssueTools(issueId: string, deps: IssueToolDeps): ToolDefinition[] {
	const need = () => {
		const record = deps.store.byId(issueId);
		if (!record) throw new Error("This issue was deleted; stop working on it.");
		return record;
	};

	const read: ToolDefinition<typeof readSchema> = {
		name: "issue_read",
		label: "Read issue",
		description: "Read the issue this session belongs to: title, status, description, and the most recent comments.",
		promptSnippet: "Read the issue behind this session",
		parameters: readSchema,
		execute: async () => {
			const record = need();
			const comments = record.comments.slice(-COMMENT_READ_LIMIT);
			const text = [
				`#${record.number} ${record.title}`,
				`Status: ${record.status}`,
				record.blocked ? `Blocked: ${record.blocked}` : "",
				"",
				record.body.trim() || "(no description)",
				comments.length > 0
					? ["", "## Comments", ...comments.map((comment) => `- [${comment.author}] ${comment.text}`)].join("\n")
					: "",
			]
				.filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
				.join("\n");
			return { content: [{ type: "text" as const, text }], details: {} };
		},
	};

	const comment: ToolDefinition<typeof commentSchema> = {
		name: "issue_comment",
		label: "Comment on issue",
		description: "Append a short note to the issue: progress, findings, or a question for the user.",
		promptSnippet: "Record progress on the issue",
		parameters: commentSchema,
		execute: async (_toolCallId, params) => {
			const record = need();
			deps.store.comment(record.id, "agent", params.text);
			deps.onChange();
			return {
				content: [{ type: "text" as const, text: `Comment recorded on issue #${record.number}.` }],
				details: {},
			};
		},
	};

	const finish: ToolDefinition<typeof finishSchema> = {
		name: "issue_finish",
		label: "Finish issue",
		description:
			"Hand the issue to the user for review with a summary of what changed. Call this when the work is done.",
		promptSnippet: "Hand the issue over for review",
		promptGuidelines: [
			"Finish an issue with issue_finish, never by claiming it is done without the tool.",
			"Never close an issue yourself; only the user closes it after reviewing the work.",
		],
		parameters: finishSchema,
		execute: async (_toolCallId, params) => {
			const record = need();
			deps.store.setStatus(record.id, "review", { blocked: null, error: null });
			deps.store.comment(record.id, "agent", params.summary);
			deps.onChange();
			return {
				content: [
					{
						type: "text" as const,
						text: `Issue #${record.number} is waiting for the user's review. Stop working on it.`,
					},
				],
				details: {},
			};
		},
	};

	const block: ToolDefinition<typeof blockSchema> = {
		name: "issue_block",
		label: "Block issue",
		description: "Stop and ask the user for what you are missing: a decision, credentials, or access.",
		promptSnippet: "Ask the user for what is missing",
		promptGuidelines: ["Use issue_block instead of guessing when a decision or access is missing."],
		parameters: blockSchema,
		execute: async (_toolCallId, params) => {
			const record = need();
			const reason = params.reason.trim() || "Blocked";
			deps.store.setStatus(record.id, "open", { blocked: reason, error: null });
			deps.store.comment(record.id, "agent", reason);
			deps.onChange();
			return {
				content: [
					{
						type: "text" as const,
						text: `Issue #${record.number} is blocked and back in the open list. Stop working on it.`,
					},
				],
				details: {},
			};
		},
	};

	return [read, comment, finish, block];
}
