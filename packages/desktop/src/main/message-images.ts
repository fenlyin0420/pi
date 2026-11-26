// 用户消息里的图片块：内置查看器显示它们靠这里取出 base64，粘贴进来的图片只有这份数据。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageView } from "../shared/contract.ts";

/** 消息里的图片块：data 是 base64 正文，mimeType 是它自己的类型。 */
type ImageBlock = { type: "image"; data: string; mimeType: string };

/**
 * 一条用户消息里的第 index 张图片（只数图片块），给内置查看器显示。
 * 不是用户消息或下标越界时返回 null。
 */
export function imageViewOf(message: AgentMessage, index: number): ImageView | null {
	if (message.role !== "user" || !Array.isArray(message.content)) return null;
	const image = message.content.filter((block): block is ImageBlock => block.type === "image")[index];
	if (!image) return null;
	return { path: null, name: `Image ${index + 1}`, dataUrl: `data:${image.mimeType};base64,${image.data}` };
}
