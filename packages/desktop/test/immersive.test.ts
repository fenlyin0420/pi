// 沉浸模式输入的单元测试：render_html 结果的校验分支，以及正文围栏块兜底的取用规则。

import { describe, expect, it } from "vitest";
import { MAX_ARTIFACT_BYTES } from "../src/main/artifacts.ts";
import { fenceArtifact, IMMERSIVE_PROMPT, readArtifactCall } from "../src/main/immersive.ts";

const PAGE = "<!doctype html><html><body>hi</body></html>";

describe("readArtifactCall", () => {
	it("工具名不对时不算产物", () => {
		expect(readArtifactCall("read", { title: "T", html: PAGE })).toBeNull();
	});

	it("标题为空或缺失时不算产物", () => {
		expect(readArtifactCall("render_html", { title: "  ", html: PAGE })).toBeNull();
		expect(readArtifactCall("render_html", { html: PAGE })).toBeNull();
		expect(readArtifactCall("render_html", null)).toBeNull();
	});

	it("正文不以 < 开头时不算产物（多半是一段解释）", () => {
		expect(readArtifactCall("render_html", { title: "T", html: "sorry, I cannot" })).toBeNull();
	});

	it("正文超过上限时不算产物，刚好到上限可以", () => {
		const exact = `<p>${"a".repeat(MAX_ARTIFACT_BYTES - 7)}</p>`;
		expect(exact.length).toBe(MAX_ARTIFACT_BYTES);
		expect(readArtifactCall("render_html", { title: "T", html: exact })?.html).toBe(exact);
		expect(readArtifactCall("render_html", { title: "T", html: `${exact}a` })).toBeNull();
	});

	it("合规矩的 details 读成标题与正文", () => {
		expect(readArtifactCall("render_html", { title: "  Counter  ", html: PAGE })).toEqual({
			title: "Counter",
			html: PAGE,
		});
	});
});

describe("fenceArtifact", () => {
	it("唯一的 html 围栏块取出来，标题用文档自己的 title", () => {
		const text = ["Here you go:", "", "```html", "<!doctype html><title>Counter</title><p>x</p>", "```"].join("\n");
		expect(fenceArtifact(text)).toEqual({
			title: "Counter",
			html: "<!doctype html><title>Counter</title><p>x</p>",
		});
	});

	it("没有 title 时给一个中性名字", () => {
		expect(fenceArtifact(["```html", "<p>x</p>", "```"].join("\n"))?.title).toBe("HTML page");
	});

	it("多于一块时哪块都不算", () => {
		const text = ["```html", "<p>a</p>", "```", "```html", "<p>b</p>", "```"].join("\n");
		expect(fenceArtifact(text)).toBeNull();
	});

	it("没有围栏块或围栏未闭合时不算", () => {
		expect(fenceArtifact("no html here")).toBeNull();
		expect(fenceArtifact(["```html", "<p>a</p>"].join("\n"))).toBeNull();
	});

	it("别的语言的围栏块不被认成产物", () => {
		expect(fenceArtifact(["```ts", "const a = 1;", "```"].join("\n"))).toBeNull();
	});

	it("超过上限时不算", () => {
		const html = `<p>${"a".repeat(MAX_ARTIFACT_BYTES)}</p>`;
		expect(fenceArtifact(["```html", html, "```"].join("\n"))).toBeNull();
	});
});

describe("IMMERSIVE_PROMPT", () => {
	it("说清只交一次 render_html、不许外链、交互走 window.pi.submit", () => {
		expect(IMMERSIVE_PROMPT).toContain("render_html");
		expect(IMMERSIVE_PROMPT).toContain("window.pi.submit");
		expect(IMMERSIVE_PROMPT).toContain("no CDN");
	});

	it("页面只画内容：用户消息与下一轮输入框都是宿主画的", () => {
		expect(IMMERSIVE_PROMPT).toContain("the host already shows the user's message");
		expect(IMMERSIVE_PROMPT).toContain("Do not repeat the user's message");
	});

	it("要求用宿主注入的 --pi-* 变量，页面才和界面同一套观感", () => {
		for (const token of ["--pi-bg", "--pi-surface", "--pi-fg", "--pi-border", "--pi-accent", "--pi-radius"]) {
			expect(IMMERSIVE_PROMPT).toContain(token);
		}
	});
});
