// 一条用户消息带上的附件：先是文件卡片，再是图片缩略图；点开分别交给系统程序和内置查看器。

import { memo, useEffect, useState } from "react";
import type { ImageView, TranscriptItem } from "../../../shared/contract.ts";
import { IconFile, IconImage } from "../../icons.tsx";
import { baseName, fileType } from "../../lib/format.ts";
import { ImageViewer, type ViewerState } from "../ImageViewer.tsx";

type UserItem = Extract<TranscriptItem, { kind: "user" }>;

/** 附件区：没有附件时什么都不渲染，调用方不必先判断。 */
export const MessageAttachments = memo(function MessageAttachments({
	item,
	sessionId,
}: {
	item: UserItem;
	sessionId: string | null;
}) {
	// 点开的附件：图片进内置查看器，别的文件交给系统默认程序。读不出来时同一张卡片显示原因。
	const [viewer, setViewer] = useState<ViewerState | null>(null);

	if (item.files.length === 0 && item.imageCount === 0) return null;

	const openFile = async (path: string) => {
		try {
			const result = await window.piDesktop.openAttachment(path);
			if (result.kind === "image") setViewer({ kind: "ready", image: result.image });
		} catch (error) {
			setViewer({ kind: "error", name: baseName(path), message: messageOf(error) });
		}
	};

	return (
		<>
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
				{imageSlots(item).map((slot) => (
					<MessageImageCard
						key={slot.key}
						sessionId={sessionId}
						messageIndex={item.messageIndex}
						imageIndex={slot.imageIndex}
						onOpen={(image) => setViewer({ kind: "ready", image })}
					/>
				))}
			</div>
			<ImageViewer state={viewer} onClose={() => setViewer(null)} />
		</>
	);
});

/**
 * 一条消息里的图片槽位。图片在消息里只有位置没有名字，身份就是“这条消息的第几张”，
 * 所以 key 由消息 id 和图片下标组成；这个下标是内容身份，不是列表位置。
 */
function imageSlots(item: UserItem): { key: string; imageIndex: number }[] {
	return Array.from({ length: item.imageCount }, (_unused, imageIndex) => ({
		key: `${item.id}:image:${imageIndex}`,
		imageIndex,
	}));
}

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
