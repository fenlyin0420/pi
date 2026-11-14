// 粘进 issue 正文的图片：按文件头认清格式后写进 issues 目录的 images/，正文里只留一行 markdown 链接。

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PastedIssueImage } from "../shared/contract.ts";
import { detectImageMimeType, MAX_IMAGE_BYTES } from "./attachments.ts";

/** 存盘用的扩展名；只收读得回来的这几种，认不出的格式直接拒。 */
function extensionOf(mimeType: string): string | null {
	switch (mimeType) {
		case "image/png":
			return "png";
		case "image/jpeg":
			return "jpg";
		case "image/gif":
			return "gif";
		case "image/webp":
			return "webp";
		case "image/bmp":
			return "bmp";
		default:
			return null;
	}
}

/**
 * 正文里那一行 markdown：路径换成正斜杠（Windows 反斜杠在链接里是转义），
 * 带空格或括号时用 <…> 包成链接目的地。
 */
export function imageMarkdown(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	return /[\s()<>]/.test(normalized) ? `![image](<${normalized}>)` : `![image](${normalized})`;
}

/** 把一张粘贴的图片存到 <issuesDirectory>/images/ 下，回正文里该插的那一行。 */
export async function savePastedImage(issuesDirectory: string, base64: string): Promise<PastedIssueImage> {
	const bytes = Buffer.from(base64, "base64");
	if (bytes.byteLength === 0) return { kind: "error", message: "The pasted image is empty." };
	if (bytes.byteLength > MAX_IMAGE_BYTES) return { kind: "error", message: "Image is larger than 10 MB." };
	const mimeType = detectImageMimeType(bytes);
	const extension = mimeType === null ? null : extensionOf(mimeType);
	if (extension === null) {
		return { kind: "error", message: "Only PNG, JPEG, GIF, WebP and BMP images can be pasted." };
	}
	const directory = join(issuesDirectory, "images");
	try {
		await mkdir(directory, { recursive: true });
		const path = join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`);
		await writeFile(path, bytes);
		return { kind: "ready", markdown: imageMarkdown(path) };
	} catch {
		return { kind: "error", message: "The pasted image can't be saved." };
	}
}
