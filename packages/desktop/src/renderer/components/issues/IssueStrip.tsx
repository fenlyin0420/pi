// 对话区顶部的一条指回 issue 的窄条：这条会话是某条 issue 的线程时才有。

import type { IssueSummary } from "../../../shared/contract.ts";
import { IconIssues } from "../../icons.tsx";
import { statusLabel } from "../../lib/issues.ts";

/** 只报编号、标题和状态，动作留在 issue 区：点它跳回去。 */
export function IssueStrip({ issue, onOpen }: { issue: IssueSummary; onOpen: () => void }) {
	return (
		<button type="button" className="issue-strip" onClick={onOpen}>
			<IconIssues size={14} aria-hidden="true" />
			<span className="issue-strip-number">#{issue.number}</span>
			<span className="issue-strip-title">{issue.title}</span>
			<span className="issue-strip-status">{statusLabel(issue.status)}</span>
			<span className="issue-strip-link">Open issue</span>
		</button>
	);
}
