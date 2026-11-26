// 附件块格式的单元测试：拼出来的块能被原样剥回去，用户自己写的正文不受影响。

import { describe, expect, it } from "vitest";
import { formatAttachedFiles, splitAttachedFiles } from "../src/shared/attached-files.ts";

describe("formatAttachedFiles", () => {
	it("没有附件时不产生块", () => {
		expect(formatAttachedFiles([])).toBe("");
	});

	it("路径逐行列出，块自己带首尾换行", () => {
		expect(formatAttachedFiles(["/a/report.pdf", "src/main.ts"])).toBe(
			"<attached-files>\n/a/report.pdf\nsrc/main.ts\n</attached-files>",
		);
	});

	it("空路径丢掉，路径里的空格原样保留", () => {
		expect(formatAttachedFiles(["/a/my  file.txt", "   "])).toBe(
			"<attached-files>\n/a/my  file.txt\n</attached-files>",
		);
	});
});

describe("splitAttachedFiles", () => {
	it("剥掉块并把路径交回来", () => {
		const text = `看看这两个\n\n${formatAttachedFiles(["/a/x.pdf", "/b/y.ts"])}`;
		expect(splitAttachedFiles(text)).toEqual({ text: "看看这两个", files: ["/a/x.pdf", "/b/y.ts"] });
	});

	it("没有块时正文原样返回", () => {
		expect(splitAttachedFiles("just text")).toEqual({ text: "just text", files: [] });
	});

	it("块夹在正文中间也能剥掉，多余空行压成一条", () => {
		const text = `before\n\n${formatAttachedFiles(["/a/x.pdf"])}\n\nafter`;
		expect(splitAttachedFiles(text)).toEqual({ text: "before\n\nafter", files: ["/a/x.pdf"] });
	});

	it("格式与拆分往返一致", () => {
		const paths = ["/tmp/一.png", "/tmp/two.ts"];
		expect(splitAttachedFiles(formatAttachedFiles(paths)).files).toEqual(paths);
	});
});
