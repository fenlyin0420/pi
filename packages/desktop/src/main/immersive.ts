// 沉浸模式：render_html 工具、沉浸会话的系统提示注入，以及产物输入的校验（工具优先，正文围栏块兜底）。
// 提示词注入只在沉浸会话里生效；工具本身每个会话都注册，中途切模式不必重建会话。

import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MAX_ARTIFACT_BYTES } from "./artifacts.ts";

/** 工具名：transcript 靠它把结果认成产物而不是普通工具卡片。 */
export const RENDER_HTML_TOOL = "render_html";

const TITLE_LIMIT = 200;
const FENCE = "```";

/** 一份校验过的产物输入：工具参数或正文围栏块解出来的 `{ title, html }`。 */
export type ArtifactInput = { title: string; html: string };

/**
 * 沉浸会话每轮追加的系统提示。模型能用的只有这一份 HTML：网络是断的、外链是空的，
 * 所以唯一能出效果的是内联样式与内联 SVG；页面外面那圈（用户消息、下一轮输入框）由宿主画，
 * 页面只管内容本身。
 */
export const IMMERSIVE_PROMPT = [
	"## Immersive mode",
	"You are building a page, not writing chat text. The app shows your `render_html` result full screen, with the user's message pinned above it and a reply box below it.",
	"",
	"- Call `render_html` exactly once as the last step of every turn. Never paste HTML into your reply text.",
	"- `html` must be one complete, self-contained document starting with `<!doctype html>`.",
	"- Render only the page content: the host already shows the user's message at the top and the next-message box at the",
	"  bottom. Do not repeat the user's message and do not draw your own input box or send button.",
	"- It must not reference any external resource: no CDN, web fonts, image URLs, or `fetch`. The network is",
	"  blocked and such references render as blank boxes. Use inline SVG or `data:` URLs for images.",
	"- The host injects these CSS variables and a baseline body (background, text colour, font):",
	"  `--pi-bg`, `--pi-surface`, `--pi-raised`, `--pi-inset`, `--pi-fg`, `--pi-muted`, `--pi-faint`,",
	"  `--pi-border`, `--pi-border-strong`, `--pi-accent`, `--pi-accent-fg`, `--pi-radius`, `--pi-radius-sm`,",
	"  `--pi-font`, `--pi-mono`, `--pi-shadow`. Build surfaces, text, borders and buttons from them so the page",
	"  matches the app in both dark and light mode instead of inventing a palette.",
	'- For interaction, call `window.pi.submit("a one-line user intent")` from a click or form handler.',
	"  Only that call reaches the user; the page cannot call tools by itself. Static pages need no interaction.",
	"- One page per turn, one topic per page. Put the page name in the `title` parameter.",
].join("\n");

const renderHtmlSchema = Type.Object({
	title: Type.String({ description: "Page name, one short line", maxLength: TITLE_LIMIT }),
	html: Type.String({
		description: "One complete self-contained HTML document starting with <!doctype html>",
		maxLength: MAX_ARTIFACT_BYTES,
	}),
});

/** `render_html` 的调用结果里认出一份产物；名字、标题或正文不合规都是 null。 */
export function readArtifactCall(name: string, details: unknown): ArtifactInput | null {
	if (name !== RENDER_HTML_TOOL) return null;
	if (typeof details !== "object" || details === null) return null;
	const record = details as Record<string, unknown>;
	const title = typeof record.title === "string" ? record.title.trim() : "";
	const html = typeof record.html === "string" ? record.html : "";
	if (!title || title.length > TITLE_LIMIT) return null;
	if (!html.trimStart().startsWith("<") || html.length > MAX_ARTIFACT_BYTES) return null;
	return { title, html };
}

/**
 * 从一段正文里取出唯一的 ```html 围栏块，兜住“模型只写了正文”的轮。
 * 没有块、多于一块、未闭合或超限都返回 null：宁可什么都不渲染，也不猜哪一块是产物。
 */
export function fenceArtifact(text: string): ArtifactInput | null {
	const blocks: string[] = [];
	let open: string[] | null = null;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (open === null) {
			if (/^```html\s*$/i.test(trimmed)) open = [];
			continue;
		}
		if (trimmed.startsWith(FENCE)) {
			blocks.push(open.join("\n"));
			open = null;
			continue;
		}
		open.push(line);
	}
	if (open !== null || blocks.length !== 1) return null;
	const html = blocks[0]?.trim() ?? "";
	if (!html.startsWith("<") || html.length > MAX_ARTIFACT_BYTES) return null;
	return { title: titleOfDocument(html), html };
}

/**
 * 给一个会话用的内联扩展：注册 render_html，并在沉浸会话的每一轮把提示词接在系统提示后面。
 * `isImmersive` 在这一轮开始时才被调用，所以闭包可以晚于建会话才拿到会话 id。
 */
export function createImmersiveExtension(isImmersive: () => boolean): InlineExtension {
	return {
		name: "desktop-immersive",
		hidden: true,
		factory: (pi) => {
			pi.registerTool({
				name: RENDER_HTML_TOOL,
				label: "Render HTML",
				description:
					"Render a self-contained HTML page for the user to look at and interact with. Call it once at the end of the turn.",
				promptSnippet: "Render a self-contained HTML page",
				parameters: renderHtmlSchema,
				execute: async (_toolCallId, params) => {
					const artifact = readArtifactCall(RENDER_HTML_TOOL, params);
					if (!artifact) {
						throw new Error(
							"render_html rejected: give a non-empty title and one complete HTML document starting with '<'.",
						);
					}
					return { content: [{ type: "text" as const, text: "Rendered." }], details: artifact };
				},
			});
			pi.on("before_agent_start", (event) =>
				isImmersive() ? { systemPrompt: `${event.systemPrompt}\n\n${IMMERSIVE_PROMPT}` } : undefined,
			);
		},
	};
}

/** 围栏块没有标题时用文档自己的 `<title>`，再没有就用一个中性的名字。 */
function titleOfDocument(html: string): string {
	const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	const title = match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
	return title === "" ? "HTML page" : title.slice(0, TITLE_LIMIT);
}
