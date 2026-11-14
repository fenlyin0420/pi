// 提问 dock：当前会话在等回答的 ask_user 排在输入框上方。
// 提问按会话归属，但只有当前会话的才渲染：别的会话还在等时只挂侧栏那个空心点，切回去再画出来。

import { useEffect } from "react";
import type { AskAnswer } from "../../../shared/contract.ts";
import type { PendingAsk } from "../../store.ts";
import { AskPanel, forgetAskDrafts } from "./AskPanel.tsx";

type AskDockProps = {
	asks: readonly PendingAsk[];
	activeSessionId: string | null;
	onSubmit: (flowId: string, answers: Record<string, AskAnswer>, note: string) => void;
	onCancel: (flowId: string) => void;
};

/**
 * 一次提问一张卡，通常只有一张；同一个会话里连着问两次时才叠起来。
 * 每张卡都是 composer 栈的直接子元素，样式和 QueuedBar 一样贴在输入框上沿。
 */
export function AskDock({ asks, activeSessionId, onSubmit, onCancel }: AskDockProps) {
	// 提问一结束就把它的草稿从缓存里剔掉：缓存随 flow 生死，不随卡片可见性生死。
	useEffect(() => {
		forgetAskDrafts(new Set(asks.map((entry) => entry.request.flowId)));
	}, [asks]);

	return (
		<>
			{asks
				.filter((entry) => entry.sessionId === activeSessionId)
				.map(({ request }) => (
					<AskPanel
						key={request.flowId}
						request={request}
						onSubmit={(answers, note) => onSubmit(request.flowId, answers, note)}
						onCancel={() => onCancel(request.flowId)}
					/>
				))}
		</>
	);
}
