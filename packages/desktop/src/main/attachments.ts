// 文件附件的读取：把用户挑中或拖进窗口的路径变成 renderer 能显示、发送时能用的附件描述。
// 图片按原样读成 base64（模型直接看得到），其余只给路径，由 agent 自己的文件工具去读。

import { open, readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { PromptAttachment } from "../shared/contract.ts";
import { MAX_ATTACHMENTS } from "../shared/contract.ts";

/** 单张图片读进内存的上限：再大就让用户先换一张，省得 IPC 上搬几百兆 base64。 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** 认图片只看文件头，不读整份文件。 */
const SNIFF_BYTES = 4_100;

/** 读附件的结果：被跳过的文件带上原因，直接当 toast 文案给用户看。 */
export type AttachmentReadResult = {
	attachments: PromptAttachment[];
	rejected: string[];
};

/** 读一批路径。目录、读不出或过大的图片跳过并说明原因，其余按图片/普通文件分类。 */
export async function readAttachments(paths: readonly string[]): Promise<AttachmentReadResult> {
	const attachments: PromptAttachment[] = [];
	const rejected: string[] = [];
	for (const path of paths) {
		if (attachments.length >= MAX_ATTACHMENTS) {
			rejected.push(`At most ${MAX_ATTACHMENTS} attachments per message.`);
			break;
		}
		const attachment = await readAttachment(path, rejected);
		if (attachment) attachments.push(attachment);
	}
	return { attachments, rejected };
}

async function readAttachment(path: string, rejected: string[]): Promise<PromptAttachment | null> {
	const name = basename(path);
	try {
		const info = await stat(path);
		if (info.isDirectory()) {
			rejected.push(`${name} is a folder.`);
			return null;
		}
		const mimeType = detectImageMimeType(await readHead(path));
		if (!mimeType) return { kind: "file", name, path, size: info.size };
		if (info.size > MAX_IMAGE_BYTES) {
			rejected.push(`${name} is larger than 10 MB.`);
			return null;
		}
		const data = (await readFile(path)).toString("base64");
		return { kind: "image", name, path, mimeType, data, size: info.size };
	} catch {
		rejected.push(`${name} can't be read.`);
		return null;
	}
}

/** 文件头：判断图片格式只需要前几 KB，大文件不能整份读进来。 */
async function readHead(path: string): Promise<Buffer> {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(SNIFF_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

/** 按文件头认模型能吃的那几种图片，与 pi 的图片处理保持同一套格式。 */
export function detectImageMimeType(head: Uint8Array): string | null {
	if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
	if (startsWithAscii(head, 0, "\x89PNG\r\n\x1a\n")) return "image/png";
	if (startsWithAscii(head, 0, "GIF87a") || startsWithAscii(head, 0, "GIF89a")) return "image/gif";
	if (startsWithAscii(head, 0, "RIFF") && startsWithAscii(head, 8, "WEBP")) return "image/webp";
	if (startsWithAscii(head, 0, "BM")) return "image/bmp";
	return null;
}

function startsWithAscii(buffer: Uint8Array, offset: number, text: string): boolean {
	if (buffer.length < offset + text.length) return false;
	for (let index = 0; index < text.length; index += 1) {
		if (buffer[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}
