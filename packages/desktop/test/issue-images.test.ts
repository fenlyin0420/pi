// issue 图片地址的解析与读取：路径怎么拼、读不出来时给什么原因。

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { issueImageTarget, readIssueImage } from "../src/main/issue-images.ts";

// 1x1 的 PNG：只用到文件头，内容不必是真的图。
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function workspaceWithFile(name: string, data: Buffer | string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-desktop-issue-images-"));
	writeFileSync(join(dir, name), data);
	return dir;
}

describe("issue image target", () => {
	it("空地址与不支持的 scheme 都直接说不行", () => {
		expect(issueImageTarget("   ", "/w").kind).toBe("invalid");
		expect(issueImageTarget("blob:https://example.com/1", "/w").kind).toBe("invalid");
		expect(issueImageTarget("javascript:alert(1)", "/w").kind).toBe("invalid");
	});

	it("data URL 原样交回界面", () => {
		const dataUrl = `data:image/png;base64,${PNG_BASE64}`;
		expect(issueImageTarget(dataUrl, null)).toEqual({ kind: "inline", dataUrl });
	});

	it("http(s) 地址由 main 取回", () => {
		expect(issueImageTarget("https://example.com/a.png", "/w")).toEqual({
			kind: "remote",
			url: "https://example.com/a.png",
		});
		expect(issueImageTarget("http://example.com/a.png", null).kind).toBe("remote");
	});

	it("file:// 与绝对路径都当磁盘路径", () => {
		const absolute = resolve("shot.png");
		expect(issueImageTarget(absolute, null)).toEqual({ kind: "path", path: absolute });
		expect(issueImageTarget(pathToFileURL(absolute).href, null)).toEqual({ kind: "path", path: absolute });
	});

	it("相对路径按 workspace 解析，没有 workspace 就报错", () => {
		expect(issueImageTarget("docs/shot.png", "/w")).toEqual({
			kind: "path",
			path: resolve("/w", "docs/shot.png"),
		});
		expect(issueImageTarget("docs/shot.png", null).kind).toBe("invalid");
	});
});

describe("issue image read", () => {
	it("读到的图转成 data URL，相对路径也能读", async () => {
		const workspace = workspaceWithFile("shot.png", Buffer.from(PNG_BASE64, "base64"));
		const absolute = await readIssueImage(workspace, join(workspace, "shot.png"));
		const relative = await readIssueImage(workspace, "./shot.png");
		expect(absolute).toEqual({ kind: "ready", dataUrl: `data:image/png;base64,${PNG_BASE64}` });
		expect(relative).toEqual(absolute);
	});

	it("读不出来、不是图片、是目录都给出原因", async () => {
		const workspace = workspaceWithFile("notes.txt", "hello");
		expect(await readIssueImage(workspace, "./missing.png")).toEqual({
			kind: "error",
			message: "Image can't be read.",
		});
		expect(await readIssueImage(workspace, "./notes.txt")).toEqual({
			kind: "error",
			message: "Not an image file.",
		});
		expect(await readIssueImage(workspace, ".")).toEqual({ kind: "error", message: "That path is a folder." });
	});
});
