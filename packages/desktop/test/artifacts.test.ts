// 沉浸模式产物层的单元测试：文档拼装的三处注入位置、桥接脚本形状、CSP，以及协议地址与响应判定。

import { describe, expect, it } from "vitest";
import {
	ARTIFACT_CSP,
	ARTIFACT_SCHEME,
	artifactKey,
	artifactResponse,
	clearArtifacts,
	composeDocument,
	MAX_ARTIFACT_BYTES,
	parseArtifactRequest,
	putArtifact,
} from "../src/main/artifacts.ts";

const PAGE = "<!doctype html><html><head><title>T</title></head><body>hi</body></html>";

describe("composeDocument", () => {
	it("有 head 时注入在 head 之后", () => {
		const document = composeDocument(PAGE, "dark");
		expect(document.startsWith("<!doctype html><html><head>")).toBe(true);
		expect(document.indexOf("data-pi-artifact-bridge")).toBeLessThan(document.indexOf("<title>"));
	});

	it("只有 html 没有 head 时跟在 html 开标签之后", () => {
		const document = composeDocument("<html><body>hi</body></html>", "dark");
		expect(document.startsWith("<html><style data-pi-artifact-base>")).toBe(true);
	});

	it("裸片段注入到最前面", () => {
		const document = composeDocument("<p>bare</p>", "light");
		expect(document.startsWith("<style data-pi-artifact-base>")).toBe(true);
		expect(document.endsWith("<p>bare</p>")).toBe(true);
	});

	it("没有 head 也没有 html 时，注入落在 doctype 之后而不是它前面", () => {
		const document = composeDocument("<!doctype html><title>Chart</title><p>x</p>", "dark");
		expect(document.startsWith("<!doctype html><style")).toBe(true);
		expect(document.endsWith("<p>x</p>")).toBe(true);
	});

	it("重复拼装同一份文档不会注入第二遍", () => {
		const once = composeDocument(PAGE, "dark");
		const twice = composeDocument(once, "light");
		expect(twice).toBe(once);
		expect(twice.split("data-pi-artifact-bridge").length - 1).toBe(1);
	});

	it("主题写进桥接脚本，页面只有没自己选主题时才被覆盖", () => {
		const dark = composeDocument(PAGE, "dark");
		const light = composeDocument(PAGE, "light");
		expect(dark).toContain('dataset.theme="dark"');
		expect(light).toContain('dataset.theme="light"');
		expect(dark).toContain("if(!root.dataset.theme)");
	});

	it("桥接只暴露三个 postMessage API，且带来源标记", () => {
		const document = composeDocument(PAGE, "dark");
		for (const api of ["submit", "openExternal", "ready"]) {
			expect(document).toContain(`${api}:function(`);
		}
		expect(document).toContain("source:'pi-artifact'");
		expect(document).toContain("window.parent.postMessage(payload,'*')");
		expect(document).toContain("type:'submit'");
		expect(document).toContain("type:'openExternal'");
		expect(document).toContain("type:'ready'");
	});
});

describe("themeSheet", () => {
	it("深色与浅色各自一套 token，页面引变量就跟着界面走", () => {
		const dark = composeDocument(PAGE, "dark");
		const light = composeDocument(PAGE, "light");
		expect(dark).toContain("--pi-bg:#181818");
		expect(light).toContain("--pi-bg:#ffffff");
		expect(dark).toContain("color-scheme:dark");
		expect(light).toContain("color-scheme:light");
	});

	it("基础规则给了底色、字色和字体，不写样式的页面也不是裸 HTML", () => {
		const document = composeDocument(PAGE, "dark");
		expect(document).toContain("box-sizing:border-box");
		expect(document).toContain("background:var(--pi-bg)");
		expect(document).toContain("font-family:var(--pi-font)");
	});

	it("主题表排在模型自己的样式之前，页面里的规则仍然盖得住它", () => {
		const page = "<!doctype html><html><head><style>body{background:red}</style></head><body>x</body></html>";
		const document = composeDocument(page, "dark");
		expect(document.indexOf("data-pi-artifact-base")).toBeLessThan(document.indexOf("background:red"));
	});
});

describe("ARTIFACT_CSP", () => {
	it("放行内联脚本与样式，其他一律关掉", () => {
		expect(ARTIFACT_CSP).toContain("script-src 'unsafe-inline'");
		expect(ARTIFACT_CSP).toContain("style-src 'unsafe-inline'");
		expect(ARTIFACT_CSP).toContain("default-src 'none'");
		expect(ARTIFACT_CSP).toContain("connect-src 'none'");
		expect(ARTIFACT_CSP).not.toContain("allow-same-origin");
		expect(ARTIFACT_CSP).not.toContain("http:");
	});
});

describe("artifactKey / parseArtifactRequest", () => {
	it("拼出来的地址能被解析回同一个会话与条目", () => {
		const key = artifactKey("session-a", "artifact-2");
		expect(key).toBe("pi-artifact://session/session-a/artifact-2");
		expect(parseArtifactRequest(new URL(`${key}?theme=light`))).toEqual({
			sessionId: "session-a",
			itemId: "artifact-2",
		});
	});

	it("编码过的会话与条目名原样解回来", () => {
		const key = artifactKey("a/b c", "artifact 1");
		const parsed = parseArtifactRequest(new URL(key));
		expect(parsed?.sessionId).toBe("a/b c");
		expect(parsed?.itemId).toBe("artifact 1");
	});

	it("畸形地址一律 null", () => {
		const rejected = [
			"https://session/a/b",
			`${ARTIFACT_SCHEME}://other/a/b`,
			`${ARTIFACT_SCHEME}://session/a`,
			`${ARTIFACT_SCHEME}://session/a/b/c`,
			`${ARTIFACT_SCHEME}://session//b`,
			`${ARTIFACT_SCHEME}://session/a/%E0%A4%A`,
		];
		for (const url of rejected) {
			expect(parseArtifactRequest(new URL(url))).toBeNull();
		}
	});
});

describe("artifactResponse", () => {
	it("会话被删后它名下的投递一起失效", () => {
		const kept = artifactKey("still-here", "artifact-1");
		const dropped = artifactKey("gone", "artifact-1");
		putArtifact(kept, PAGE);
		putArtifact(dropped, PAGE);
		clearArtifacts("gone");
		expect(artifactResponse({ sessionId: "gone", itemId: "artifact-1" }, "dark").status).toBe(404);
		expect(artifactResponse({ sessionId: "still-here", itemId: "artifact-1" }, "dark").status).toBe(200);
	});

	it("投递过的正文拼成文档返回", () => {
		putArtifact(artifactKey("response-session", "artifact-1"), PAGE);
		const response = artifactResponse({ sessionId: "response-session", itemId: "artifact-1" }, "light");
		expect(response.status).toBe(200);
		expect(response.body).toContain("data-pi-artifact-bridge");
	});

	it("没投递过是 404", () => {
		expect(artifactResponse({ sessionId: "missing", itemId: "artifact-1" }, "dark")).toEqual({
			status: 404,
			body: "No such artifact",
		});
	});

	it("刚好到上限照常渲染，多一个字符就换说明页", () => {
		const html = `<p>${"a".repeat(MAX_ARTIFACT_BYTES - 7)}</p>`;
		expect(html.length).toBe(MAX_ARTIFACT_BYTES);
		putArtifact(artifactKey("size-session", "artifact-1"), html);
		expect(artifactResponse({ sessionId: "size-session", itemId: "artifact-1" }, "dark").status).toBe(200);

		putArtifact(artifactKey("size-session", "artifact-2"), `${html}a`);
		const response = artifactResponse({ sessionId: "size-session", itemId: "artifact-2" }, "dark");
		expect(response.status).toBe(413);
		expect(response.body).toContain("was not rendered");
	});
});
