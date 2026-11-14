// 磁盘记录到界面契约的纯映射：列表要摘要，选中时要正文与评论。

import type { IssueDetail, IssueSummary } from "../../shared/contract.ts";
import type { IssueRecord } from "./store.ts";

/** 列表里的样子：不带正文，快照每帧都能重发。 */
export function toIssueSummary(record: IssueRecord): IssueSummary {
	return {
		id: record.id,
		number: record.number,
		workspace: record.workspace,
		title: record.title,
		status: record.status,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		sessionId: record.sessionId,
		blocked: record.blocked,
		error: record.error,
	};
}

export function toIssueDetail(record: IssueRecord): IssueDetail {
	return { ...toIssueSummary(record), body: record.body, comments: record.comments };
}
