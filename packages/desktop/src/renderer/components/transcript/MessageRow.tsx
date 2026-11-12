// 一行非 assistant 的对话记录：用户气泡与系统提示各走各的渲染。

import { memo } from "react";
import type { TranscriptItem } from "../../../shared/contract.ts";
import { IconFile, IconImage } from "../../icons.tsx";
import { baseName } from "../../lib/format.ts";
import { cx } from "../../ui.tsx";

type MessageRowProps = {
	item: Exclude<TranscriptItem, { kind: "assistant" }>;
};

/**
 * 一条对话记录。memo 的默认浅比较就够：流式增量只替换命中的那一条 item，
 * 其余 item 的引用不变。
 */
export const MessageRow = memo(function MessageRow({ item }: MessageRowProps) {
	if (item.kind === "user") return <UserRow item={item} />;
	return <NoticeRow item={item} />;
});

const UserRow = memo(function UserRow({ item }: { item: Extract<TranscriptItem, { kind: "user" }> }) {
	return (
		<article className="message-row user" aria-label="Your message" data-item-id={item.id}>
			<div className="message-col">
				<div className="message-bubble">
					{item.text ? <div className="message-user-text selectable">{item.text}</div> : null}
					{item.files.length > 0 || item.imageCount > 0 ? (
						<span className="message-attachments">
							{item.files.map((path) => (
								<span className="message-attachment" key={path} title={path}>
									<IconFile size={13} aria-hidden="true" />
									<span>{baseName(path)}</span>
								</span>
							))}
							{item.imageCount > 0 ? (
								<span className="message-attachment">
									<IconImage size={13} aria-hidden="true" />
									<span>{`${item.imageCount} image${item.imageCount > 1 ? "s" : ""}`}</span>
								</span>
							) : null}
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
