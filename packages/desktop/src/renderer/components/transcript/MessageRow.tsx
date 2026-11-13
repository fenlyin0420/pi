// 一行非 assistant 的对话记录：用户气泡与系统提示各走各的渲染。

import { memo, useEffect, useState } from "react";
import type { ImageView, TranscriptItem } from "../../../shared/contract.ts";
import { IconFile, IconImage } from "../../icons.tsx";
import { baseName, fileType } from "../../lib/format.ts";
import { cx } from "../../ui.tsx";
import { ImageViewer, type ViewerState } from "../ImageViewer.tsx";

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
	// 点开的附件：图片进内置查看器，别的文件交给系统默认程序。读不出来时同一张卡片显示原因。
	const [viewer, setViewer] = useState<ViewerState | null>(null);

	const openFile = async (path: string) => {
		try {
			const result = await window.piDesktop.openAttachment(path);
			if (result.kind === "image") setViewer({ kind: "ready", image: result.image });
		} catch (error) {
			setViewer({ kind: "error", name: baseName(path), message: messageOf(error) });
		}
	};

	return (
		<article className="message-row user" aria-label="Your message" data-item-id={item.id}>
			<div className="message-col">
				{/* 附件先出现，用户写下的话跟在后面：读起来就是“带了什么、说了什么”。 */}
				{item.files.length > 0 || item.imageCount > 0 ? (
					<div className="message-files">
						{item.files.map((path) => (
							<button
								type="button"
								className="message-file"
								key={path}
								title={path}
								onClick={() => void openFile(path)}
							>
								<span className="message-file-icon">
									<IconFile size={15} aria-hidden="true" />
								</span>
								<span className="message-file-body">
									<span className="message-file-name">{baseName(path)}</span>
									<span className="message-file-type">{fileType(baseName(path))}</span>
								</span>
							</button>
						))}
						{Array.from({ length: item.imageCount }, (_unused, imageIndex) => (
							<MessageImageCard
								key={`${item.id}:image:${imageIndex}`}
								sessionId={sessionId}
								messageIndex={item.messageIndex}
								imageIndex={imageIndex}
								onOpen={(image) => setViewer({ kind: "ready", image })}
							/>
						))}
					</div>
				) : null}
				{item.text ? (
					<div className="message-bubble">
						<div className="message-user-text selectable">{item.text}</div>
					</div>
				) : null}
			</div>
			<ImageViewer state={viewer} onClose={() => setViewer(null)} />
		</article>
	);
});

/**
 * 一条消息里的一张图片：挂上就回 main 取图，取到了直接显示缩略图（点开进查看器）。
 * 图片在消息里只有位置没有名字，所以身份就是“这条消息的第几张”。
 */
const MessageImageCard = memo(function MessageImageCard({
	sessionId,
	messageIndex,
	imageIndex,
	onOpen,
}: {
	sessionId: string | null;
	messageIndex: number;
	imageIndex: number;
	onOpen: (image: ImageView) => void;
}) {
	const [image, setImage] = useState<ImageView | null>(null);
	const [unavailable, setUnavailable] = useState(false);
	const name = `Image ${imageIndex + 1}`;

	useEffect(() => {
		if (sessionId === null) return;
		let current = true;
		const fail = () => {
			if (current) setUnavailable(true);
		};
		try {
			void window.piDesktop.readMessageImage(sessionId, messageIndex, imageIndex).then((result) => {
				if (!current) return;
				if (result) setImage(result);
				else fail();
			}, fail);
		} catch {
			// 桥没注入（main/preload 还是旧构建）时这里会同步抛，按“拿不到”处理，不炸掉整行。
			fail();
		}
		return () => {
			current = false;
		};
	}, [sessionId, messageIndex, imageIndex]);

	if (image === null) {
		return (
			<span className="message-file is-static" title={name}>
				<span className="message-file-icon">
					<IconImage size={15} aria-hidden="true" />
				</span>
				<span className="message-file-body">
					<span className="message-file-name">{unavailable ? name : "Loading…"}</span>
					<span className="message-file-type">{unavailable ? "UNAVAILABLE" : "IMAGE"}</span>
				</span>
			</span>
		);
	}

	return (
		<button type="button" className="message-file-image" title={`Open ${name}`} onClick={() => onOpen(image)}>
			<img className="message-file-thumb" src={image.dataUrl} alt={name} />
		</button>
	);
});

/** 桥接调用失败时的文案：能拿到 Error 就用它的 message，否则把它转成字符串。 */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const NoticeRow = memo(function NoticeRow({ item }: { item: Extract<TranscriptItem, { kind: "notice" }> }) {
	return (
		<article className="message-row notice" aria-label={`System notice: ${item.level}`}>
			<div className="message-col">
				<pre className={cx("message-notice", `is-${item.level}`)}>{item.text}</pre>
			</div>
		</article>
	);
});
