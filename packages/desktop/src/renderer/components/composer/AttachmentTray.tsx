// 附件托盘：待发送图片的缩略图与删除入口，以及把文件读成 PromptImage 的转换。

import type { PromptImage } from "../../../shared/contract.ts";
import { IconClose } from "../../icons.tsx";

/** 一次提示最多带几张图。 */
export const MAX_ATTACHMENTS = 6;

/** dataURL 的前缀只是媒介描述，契约里的 data 只要 base64 正文。 */
const DATA_URL_PREFIX = /^data:[^,]*,/;

/** 托盘里的一张图：id 由添加时分配，同一张图连贴两次也各有自己的位置。 */
export type ComposerAttachment = { id: number; image: PromptImage };

type AttachmentTrayProps = {
	attachments: readonly ComposerAttachment[];
	onRemove: (id: number) => void;
};

/** 把文件读成模型能看的图片；非图片文件和读不出来的文件都跳过。 */
export async function readImageFiles(files: Iterable<File>): Promise<PromptImage[]> {
	const images: PromptImage[] = [];
	for (const file of files) {
		if (!file.type.startsWith("image/")) continue;
		const url = await readAsDataUrl(file).catch(() => "");
		if (!DATA_URL_PREFIX.test(url)) continue;
		images.push({ data: url.replace(DATA_URL_PREFIX, ""), mimeType: file.type, name: file.name || undefined });
	}
	return images;
}

/** 读取单个文件为 dataURL；读不出来时抛出，由 readImageFiles 当作跳过。 */
function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
		reader.onerror = () => reject(reader.error ?? new Error("cannot read file"));
		reader.readAsDataURL(file);
	});
}

/** 缩略图条；没有图片时不渲染，输入框保持原来的上间距。 */
export function AttachmentTray({ attachments, onRemove }: AttachmentTrayProps) {
	if (attachments.length === 0) return null;
	return (
		<div className="composer-attachments">
			{attachments.map(({ id, image }) => (
				<figure className="composer-attachment" key={id}>
					<img
						className="composer-attachment-image"
						src={`data:${image.mimeType};base64,${image.data}`}
						alt={image.name ?? "Attached image"}
					/>
					<button
						type="button"
						className="composer-attachment-remove"
						aria-label="Remove image"
						title="Remove image"
						onClick={() => onRemove(id)}
					>
						<IconClose size={11} aria-hidden="true" />
					</button>
				</figure>
			))}
		</div>
	);
}
