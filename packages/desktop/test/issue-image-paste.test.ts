// 粘贴图片存盘：写进 <issues 目录>/images/，正文只留一行 markdown 链接。

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { imageMarkdown, savePastedImage } from "../src/main/issue-image-paste.ts";

// 1x1 的 PNG：只用到文件头，内容不必是真的图。
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function freshDirectory(): string {
	return mkdtempSync(join(tmpdir(), "pi-desktop-issue-paste-"));
}

describe("image markdown", () => {
	it("普通路径正斜杠直写，Windows 反斜杠也换成正斜杠", () => {
		expect(imageMarkdown("/tmp/a.png")).toBe("![image](/tmp/a.png)");
		expect(imageMarkdown("C:\\Users\\me\\a.png")).toBe("![image](C:/Users/me/a.png)");
	});

	it("带空格或括号时用 <...> 包起来，链接才不会被截断", () => {
		expect(imageMarkdown("C:\\Users\\Me User\\shot (1).png")).toBe("![image](<C:/Users/Me User/shot (1).png>)");
	});
});

describe("save pasted image", () => {
	it("存到 images/ 下，回一行指向文件的 markdown", async () => {
		const directory = freshDirectory();
		const saved = await savePastedImage(directory, PNG_BASE64);
		if (saved.kind !== "ready") throw new Error(saved.message);

		const path = /^!\[image\]\((.+)\)$/.exec(saved.markdown)?.[1] ?? "";
		const normalize = (value: string) => value.replace(/\\/g, "/");
		expect(normalize(path)).toMatch(/\/images\/\d+-[0-9a-f]{8}\.png$/);
		expect(readFileSync(path).toString("base64")).toBe(PNG_BASE64);
	});

	it("空内容、不是图片、超大图都拒掉并说明原因", async () => {
		const directory = freshDirectory();
		expect(await savePastedImage(directory, "")).toEqual({
			kind: "error",
			message: "The pasted image is empty.",
		});
		expect(await savePastedImage(directory, Buffer.from("hello").toString("base64"))).toEqual({
			kind: "error",
			message: "Only PNG, JPEG, GIF, WebP and BMP images can be pasted.",
		});
		const huge = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "binary"), Buffer.alloc(10 * 1024 * 1024)]);
		expect(await savePastedImage(directory, huge.toString("base64"))).toEqual({
			kind: "error",
			message: "Image is larger than 10 MB.",
		});
	});
});
