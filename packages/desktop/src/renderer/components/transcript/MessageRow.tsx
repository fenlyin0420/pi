// 一行非 assistant 的对话记录：用户气泡与系统提示各走各的渲染。

import { memo } from "react";
import type { TranscriptItem } from "../../../shared/contract.ts";
import { cx } from "../../ui.tsx";
import { CopyMessageButton } from "./CopyMessageButton.tsx";
import { MessageAttachments } from "./MessageAttachments.tsx";

type MessageRowProps = {
	item: Exclude<TranscriptItem, { kind: "assistant" }>;
	/** 活动会话 id；消息里的图片按它回 main 取（粘贴进来的图没有磁盘路径）。 */
	sessionId: string | null;
};

/**
 * 一条对话记录。memo 的默认浅比较就够：流式增量只替换命中的那一条 item，
 * 其余 item 的引用不变。
 */
export const MessageRow = memo(function MessageRow({ item, sessionId }: MessageRowProps) {
	if (item.kind === "user") return <UserRow item={item} sessionId={sessionId} />;
	return <NoticeRow item={item} />;
});

const UserRow = memo(function UserRow({
	item,
	sessionId,
}: {
	item: Extract<TranscriptItem, { kind: "user" }>;
	sessionId: string | null;
}) {
	return (
		<article className="message-row user" aria-label="Your message" data-item-id={item.id}>
			<div className="message-col">
				{/* 附件先出现，用户写下的话跟在后面：读起来就是“带了什么、说了什么”。 */}
				<MessageAttachments item={item} sessionId={sessionId} />
				{item.text ? (
					<div className="message-bubble">
						<div className="message-user-text selectable">{item.text}</div>
					</div>
				) : null}
				{/* 复制的只有用户写下的话：附件在磁盘上，不在剪贴板的意义范围里。 */}
				{item.text ? (
					<div className="message-actions">
						<CopyMessageButton text={item.text} label="Copy message" />
					</div>
				) : null}
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
