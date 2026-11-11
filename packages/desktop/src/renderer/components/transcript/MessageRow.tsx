// 一行对话的分发：用户气泡、assistant 整列、系统提示各走各的渲染。

import { memo } from "react";
import type { TranscriptItem } from "../../../shared/contract.ts";
import { IconImage } from "../../icons.tsx";
import { cx } from "../../ui.tsx";
import { AssistantTurn } from "./AssistantTurn.tsx";

type MessageRowProps = {
	item: TranscriptItem;
	showThinking: boolean;
	showUsage: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
};

/**
 * 一条 transcript 记录。memo 的默认浅比较就够：流式增量只替换命中的那一条
 * item，其余 item 的引用不变，因此只有正在生成的最后一行会重渲染。
 */
export const MessageRow = memo(function MessageRow({
	item,
	showThinking,
	showUsage,
	showToolDetails,
	onOpenExternal,
}: MessageRowProps) {
	if (item.kind === "user") return <UserRow item={item} />;
	if (item.kind === "notice") return <NoticeRow item={item} />;
	return (
		<AssistantTurn
			item={item}
			showThinking={showThinking}
			showUsage={showUsage}
			showToolDetails={showToolDetails}
			onOpenExternal={onOpenExternal}
		/>
	);
});

const UserRow = memo(function UserRow({ item }: { item: Extract<TranscriptItem, { kind: "user" }> }) {
	return (
		<article className="message-row user" aria-label="Your message" data-item-id={item.id}>
			<div className="message-col">
				<div className="message-bubble">
					<div className="message-user-text selectable">{item.text}</div>
					{item.imageCount > 0 ? (
						<span className="message-attachment">
							<IconImage size={13} />
							<span>{`${item.imageCount} image${item.imageCount > 1 ? "s" : ""}`}</span>
						</span>
					) : null}
				</div>
			</div>
		</article>
	);
});

const NoticeRow = memo(function NoticeRow({ item }: { item: Extract<TranscriptItem, { kind: "notice" }> }) {
	return (
		<article className="message-row notice" aria-label={`System notice: ${item.level}`}>
			<div className="message-col">
				<pre className={cx("message-notice", `is-${item.level}`)}>{item.text}</pre>
			</div>
		</article>
	);
});
