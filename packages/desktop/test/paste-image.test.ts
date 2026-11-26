// 粘贴图片的渲染侧逻辑：认剪贴板里的图片，把链接插到选区位置。

import { describe, expect, it } from "vitest";
import { insertMarkdown, pastedImageFile } from "../src/renderer/lib/paste-image.ts";

describe("pasted image file", () => {
	it("只认图片，文本文件与空剪贴板都不算", () => {
		const image = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
		const text = new File(["hello"], "notes.txt", { type: "text/plain" });
		expect(pastedImageFile([text, image])).toBe(image);
		expect(pastedImageFile([text])).toBeNull();
		expect(pastedImageFile([])).toBeNull();
	});
});

describe("insert markdown", () => {
	const link = "![image](/tmp/a.png)";

	it("空正文直接放进第一行", () => {
		expect(insertMarkdown("", 0, 0, link)).toEqual({ text: link, caret: link.length });
	});

	it("在段落末尾插入时另起一行，光标落在链接后面", () => {
		const next = insertMarkdown("see this:", 9, 9, link);
		expect(next.text).toBe(`see this:\n${link}`);
		expect(next.caret).toBe(next.text.length);
	});

	it("替换选中文字时把链接单独放一行，不和相邻段落粘在一起", () => {
		const text = "before REPLACE\nafter";
		const next = insertMarkdown(text, 7, 14, link);
		expect(next.text).toBe(`before \n${link}\nafter`);
		expect(next.caret).toBe(`before \n${link}`.length);
	});

	it("行首插入不加多余空行", () => {
		expect(insertMarkdown("keep\n", 0, 0, link)).toEqual({ text: `${link}\nkeep\n`, caret: link.length });
	});
});
