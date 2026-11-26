// 一条 issue 的动作条：队列在列表的勾选框里管，这里只剩状态相关的动作和删除。

import { useState } from "react";
import type { IssueDetail as Detail } from "../../../shared/contract.ts";
import { Button } from "../../ui.tsx";

/** 运行中不提供动作：要停就停整个队列，一条半路停下没有意义。 */
export function IssueActions({
	detail,
	onStatus,
	onOpenThread,
	onDelete,
}: {
	detail: Detail;
	onStatus: (action: "close" | "reopen", id: string) => void;
	onOpenThread: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	// 删除按两次才落地：issue 连同评论一起没了，没有撤销。
	const [armed, setArmed] = useState(false);

	return (
		<>
			{detail.sessionId ? (
				<Button variant="secondary" onClick={() => onOpenThread(detail.id)}>
					Open thread
				</Button>
			) : null}
			{detail.status === "review" ? (
				<Button variant="primary" onClick={() => onStatus("close", detail.id)}>
					Close as done
				</Button>
			) : null}
			{detail.status === "closed" ? (
				<Button variant="secondary" onClick={() => onStatus("reopen", detail.id)}>
					Reopen
				</Button>
			) : null}
			{armed ? (
				<>
					<Button
						variant="primary"
						onClick={() => {
							setArmed(false);
							onDelete(detail.id);
						}}
					>
						Delete for good
					</Button>
					<Button variant="ghost" onClick={() => setArmed(false)}>
						Cancel
					</Button>
				</>
			) : (
				<Button variant="ghost" onClick={() => setArmed(true)}>
					Delete
				</Button>
			)}
		</>
	);
}
