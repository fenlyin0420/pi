// issue 正文里的图片：把 markdown 里的路径或 URL 换成 data URL 交给渲染进程。
// 渲染进程的 CSP 只放 data: / blob:，所以图片一律在这里读好；相对路径按 issue 所属 workspace 解析。

import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IssueImage } from "../shared/contract.ts";
import { detectImageMimeType, MAX_IMAGE_BYTES, readHead } from "./attachments.ts";

/** 远程图的上限：一张图坏掉不该把详情面板一直挂在加载态。 */
const FETCH_TIMEOUT_MS = 10_000;

/** 图片地址认得出的几种形态；解析规则是纯函数，路径怎么拼能单独测。 */
export type IssueImageTarget =
	| { kind: "inline"; dataUrl: string }
	| { kind: "remote"; url: string }
	| { kind: "path"; path: string }
	| { kind: "invalid"; message: string };

/**
 * 认出 markdown 图片地址说的是什么：内联 data URL、http(s) URL、磁盘路径（绝对，或相对 workspace）。
 * 地址来自用户写的 markdown，是这个函数的信任边界。
 */
export function issueImageTarget(source: string, workspace: string | null): IssueImageTarget {
	const trimmed = source.trim();
	if (trimmed === "") return { kind: "invalid", message: "Image address is empty." };
	if (/^data:image\//i.test(trimmed)) return { kind: "inline", dataUrl: trimmed };
	if (/^https?:\/\//i.test(trimmed)) return { kind: "remote", url: trimmed };
	if (/^file:\/\//i.test(trimmed)) {
		try {
			return { kind: "path", path: fileURLToPath(trimmed) };
		} catch {
			return { kind: "invalid", message: "Image address is not a file URL." };
		}
	}
	// blob: 之类由渲染进程自己造，存进 issue 正文后无处可取。
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[a-z]:[\\/]/i.test(trimmed)) {
		return { kind: "invalid", message: "Only files and http(s) images are supported." };
	}
	if (isAbsolute(trimmed)) return { kind: "path", path: trimmed };
	if (workspace === null) return { kind: "invalid", message: "Relative image paths need a workspace." };
	return { kind: "path", path: resolve(workspace, trimmed) };
}

/** 读一张 issue 图片；失败原因原样给界面显示在图的位置上。 */
export async function readIssueImage(workspace: string | null, source: string): Promise<IssueImage> {
	const target = issueImageTarget(source, workspace);
	switch (target.kind) {
		case "invalid":
			return { kind: "error", message: target.message };
		case "inline":
			return { kind: "ready", dataUrl: target.dataUrl };
		case "path":
			return readImageFile(target.path);
		case "remote":
			return fetchImage(target.url);
	}
}

async function readImageFile(path: string): Promise<IssueImage> {
	try {
		const info = await stat(path);
		if (info.isDirectory()) return { kind: "error", message: "That path is a folder." };
		if (info.size > MAX_IMAGE_BYTES) return { kind: "error", message: "Image is larger than 10 MB." };
		const mimeType = detectImageMimeType(await readHead(path));
		if (!mimeType) return { kind: "error", message: "Not an image file." };
		const data = (await readFile(path)).toString("base64");
		return { kind: "ready", dataUrl: `data:${mimeType};base64,${data}` };
	} catch {
		return { kind: "error", message: "Image can't be read." };
	}
}

async function fetchImage(url: string): Promise<IssueImage> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!response.ok) return { kind: "error", message: `Image request failed (${response.status}).` };
		const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
		if (!mimeType.startsWith("image/")) return { kind: "error", message: "That URL is not an image." };
		const bytes = await response.arrayBuffer();
		if (bytes.byteLength > MAX_IMAGE_BYTES) return { kind: "error", message: "Image is larger than 10 MB." };
		return { kind: "ready", dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}` };
	} catch {
		return { kind: "error", message: "Image can't be loaded." };
	}
}
