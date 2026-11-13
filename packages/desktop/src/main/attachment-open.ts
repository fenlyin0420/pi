// 点开用户消息里的一个附件：图片读出 data URL 交给内置查看器，其余由 index 交给系统默认程序。

import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { ImageView } from "../shared/contract.ts";
import { detectImageMimeType, MAX_IMAGE_BYTES, readHead } from "./attachments.ts";

/**
 * 读一张图给内置查看器。不是图片、读不出或超过上限都返回 null：
 * 这几类都该让用户用外部程序看，而不是在查看器里报错。
 */
export async function readImageView(path: string): Promise<ImageView | null> {
	try {
		const info = await stat(path);
		if (info.isDirectory() || info.size > MAX_IMAGE_BYTES) return null;
		const mimeType = detectImageMimeType(await readHead(path));
		if (!mimeType) return null;
		const dataUrl = `data:${mimeType};base64,${(await readFile(path)).toString("base64")}`;
		return { path, name: basename(path), dataUrl };
	} catch {
		return null;
	}
}
