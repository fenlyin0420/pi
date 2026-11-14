// 图片地址的放行规则：Windows 路径不被白名单抹成空串，危险链接仍然被清掉。

import { describe, expect, it } from "vitest";
import { keepImageSource } from "../src/renderer/lib/markdown-url.ts";

describe("markdown url transform", () => {
	it("src 原样保留：盘符路径、file://、data: 都交给图片解析管线", () => {
		for (const url of ["C:/Users/Me User/shot (1).png", "file:///C:/a.png", "data:image/png;base64,AAA"]) {
			expect(keepImageSource(url, "src")).toBe(url);
		}
	});

	it("href 仍走默认白名单", () => {
		expect(keepImageSource("https://example.com", "href")).toBe("https://example.com");
		expect(keepImageSource("/relative/path", "href")).toBe("/relative/path");
		expect(keepImageSource("javascript:alert(1)", "href")).toBe("");
	});
});
