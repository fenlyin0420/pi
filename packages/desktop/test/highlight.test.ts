// 路径到高亮语言：按扩展名挑语法，认不出来就交给纯文本渲染。

import { describe, expect, it } from "vitest";
import { langForPath } from "../src/renderer/lib/highlight.ts";

describe("langForPath", () => {
	it("resolves common extensions and their aliases", () => {
		expect(langForPath("src/main/transcript.ts")).toBe("typescript");
		expect(langForPath("D:\\GitHub\\pi\\src\\App.tsx")).toBe("tsx");
		expect(langForPath("styles/changes.css")).toBe("css");
		expect(langForPath("pipelines/ci.yml")).toBe("yaml");
		expect(langForPath("README.md")).toBe("markdown");
	});

	it("returns null when there is nothing to resolve", () => {
		expect(langForPath("Makefile")).toBeNull();
		expect(langForPath("notes.log")).toBeNull();
		expect(langForPath(".gitignore")).toBeNull();
	});
});
