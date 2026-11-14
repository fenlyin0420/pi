// 一次运行发给线程会话的提示：issue 正文 + 上次运行之后用户补充的内容 + 交卷规则。

import type { IssueRecord } from "./store.ts";

/** 挑出上次运行之后用户写的评论；第一次运行时就是空数组。 */
const RECENT_COMMENT_LIMIT = 20;

/**
 * 组装首轮/续跑提示。复用线程会话时发的是“补了什么”，不重放整条 issue：
 * 会话里已经有正文那一轮，再贴一遍只是烧上下文。
 */
export function runPrompt(issue: IssueRecord): string {
	const since = issue.lastRunAt ?? 0;
	const notes = issue.comments
		.filter((comment) => comment.author === "user" && comment.at > since)
		.slice(-RECENT_COMMENT_LIMIT);

	return [
		`Resolve issue #${issue.number} in this workspace.`,
		"",
		`## ${issue.title}`,
		"",
		issue.body.trim() || "(no description)",
		notes.length > 0 ? ["", "## Added since the last run", ...notes.map((note) => `- ${note.text}`)].join("\n") : "",
		"",
		"## How to finish",
		"- Change the files in this workspace; do not only describe a plan.",
		"- Call issue_finish with a short summary when the issue is done.",
		"- Call issue_block with what you need if you cannot proceed.",
		"- Never close the issue yourself: the user reviews the work and closes it.",
	]
		.filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
		.join("\n");
}
