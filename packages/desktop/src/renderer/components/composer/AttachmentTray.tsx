// 附件托盘：待发送的图片与文件，以及把没有磁盘路径的图片读成附件描述的转换。

import type { PromptAttachment } from "../../../shared/contract.ts";
import { IconClose, IconFile } from "../../icons.tsx";
import { formatBytes } from "../../lib/format.ts";

/** dataURL 的前缀只是媒介描述，契约里的 data 只要 base64 正文。 */
const DATA_URL_PREFIX = /^data:[^,]*,/;

/** 托盘里的一份附件：id 由添加时分配，同一个文件加两次也各有自己的位置。 */
export type ComposerAttachment = { id: number; attachment: PromptAttachment };

type AttachmentTrayProps = {
	attachments: readonly ComposerAttachment[];
	onRemove: (id: number) => void;
};

/**
 * 没有磁盘路径的图片读成附件：粘贴板截图、从浏览器里拖来的图片都走这条。
 * 非图片内容不接管；附件里 path 为 null。
 */
export async function readImageFiles(files: Iterable<File>): Promise<PromptAttachment[]> {
	const images: PromptAttachment[] = [];
	for (const file of files) {
		if (!file.type.startsWith("image/")) continue;
		const url = await readAsDataUrl(file).catch(() => "");
		if (!DATA_URL_PREFIX.test(url)) continue;
		images.push({
			kind: "image",
			name: file.name || "Pasted image",
			path: null,
			mimeType: file.type,
			data: url.replace(DATA_URL_PREFIX, ""),
			size: file.size,
		});
	}
	return images;
}

/** 读取单个文件为 dataURL；读不出来时抛出，由调用方当作跳过。 */
function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
		reader.onerror = () => reject(reader.error ?? new Error("cannot read file"));
		reader.readAsDataURL(file);
	});
}

/** 附件条：图片是缩略图，其他文件是带名字和大小的 chip；没有附件时不渲染。 */
export function AttachmentTray({ attachments, onRemove }: AttachmentTrayProps) {
	if (attachments.length === 0) return null;
	return (
		<div className="composer-attachments">
			{attachments.map(({ id, attachment }) =>
				attachment.kind === "image" ? (
					<figure className="composer-attachment" key={id}>
						<img
							className="composer-attachment-image"
							src={`data:${attachment.mimeType};base64,${attachment.data}`}
							alt={attachment.name}
						/>
						<button
							type="button"
							className="composer-attachment-remove"
							aria-label={`Remove ${attachment.name}`}
							title="Remove image"
							onClick={() => onRemove(id)}
						>
							<IconClose size={11} aria-hidden="true" />
						</button>
					</figure>
				) : (
					<span className="composer-attachment-file" key={id} title={attachment.path}>
						<IconFile size={13} aria-hidden="true" />
						<span className="composer-attachment-file-name">{attachment.name}</span>
						<span className="composer-attachment-file-size">{formatBytes(attachment.size)}</span>
						<button
							type="button"
							className="composer-attachment-file-remove"
							aria-label={`Remove ${attachment.name}`}
							title="Remove file"
							onClick={() => onRemove(id)}
						>
							<IconClose size={11} aria-hidden="true" />
						</button>
					</span>
				),
			)}
		</div>
	);
}
