// 沉浸模式的 HTML 产物：单份文档的上限、沙箱 CSP、宿主桥接脚本的注入，以及给协议 handler 用的缓存。
// 纯函数与模块级缓存，不 import Electron；协议的注册与处理在 artifact-protocol.ts。

import { ARTIFACT_SCHEME, type ArtifactRequest, artifactKey, parseArtifactRequest } from "../shared/artifact-url.ts";

export { ARTIFACT_SCHEME, artifactKey, parseArtifactRequest };

/** 单份产物正文的上限：会话文件里存的就是这份 HTML，太大就该走外部文件而不是消息。 */
export const MAX_ARTIFACT_BYTES = 512 * 1024;

/**
 * 产物文档的 CSP：断网、禁外链、只放内联脚本与样式。
 * 脚本必须放行内联——帧里的页面就是模型写的 `<script>`；没有 `allow-same-origin` 的沙箱
 * 又让它碰不到宿主，这两层合起来才是边界，所以不做 DOMPurify 清洗。
 */
export const ARTIFACT_CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/** 注入过桥接脚本的标记：重复 compose 同一份 HTML 不再注入第二遍。 */
const BRIDGE_MARKER = "data-pi-artifact-bridge";

/** 宿主注入的主题表标记：重复 compose 同一份 HTML 时靠它认出来。 */
const BASE_MARKER = "data-pi-artifact-base";

/** 两套主题共用的尺度：圆角、字体、阴影，页面直接引变量就能跟宿主同一个观感。 */
const BASE_TOKENS =
	"--pi-radius:14px;--pi-radius-sm:10px;" +
	'--pi-font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;' +
	'--pi-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;';

/** 深色取值跟桌面端的 dark token 对齐（同一批灰阶），浅色同理。 */
const DARK_TOKENS =
	"--pi-bg:#181818;--pi-surface:#212121;--pi-raised:#282828;--pi-inset:#0d0d0d;" +
	"--pi-fg:#ffffff;--pi-muted:rgba(255,255,255,.7);--pi-faint:rgba(255,255,255,.52);" +
	"--pi-border:rgba(255,255,255,.08);--pi-border-strong:rgba(255,255,255,.14);" +
	"--pi-accent:#ffffff;--pi-accent-fg:#181818;" +
	"--pi-shadow:0 1px 2px rgba(0,0,0,.35);";

const LIGHT_TOKENS =
	"--pi-bg:#ffffff;--pi-surface:#f9f9f9;--pi-raised:#f3f3f3;--pi-inset:#ededed;" +
	"--pi-fg:#1a1c1f;--pi-muted:rgba(26,28,31,.74);--pi-faint:rgba(26,28,31,.45);" +
	"--pi-border:rgba(26,28,31,.08);--pi-border-strong:rgba(26,28,31,.14);" +
	"--pi-accent:#1a1c1f;--pi-accent-fg:#ffffff;" +
	"--pi-shadow:0 1px 2px rgba(0,0,0,.1),0 0 0 .5px rgba(0,0,0,.04);";

/**
 * 起点样式：只给盒子模型、底色、字色和字体。模型页面自己写的规则排在后面，照样盖得住，
 * 所以这份不是限制，而是让不写样式的页面也不会变成白底黑字的裸 HTML。
 */
const BASE_RULES =
	"*,*::before,*::after{box-sizing:border-box}" +
	"body{margin:0;background:var(--pi-bg);color:var(--pi-fg);" +
	"font-family:var(--pi-font);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}" +
	"input,textarea,select,button{font:inherit;color:inherit}" +
	"::selection{background:color-mix(in oklab,var(--pi-fg) 24%,transparent)}";

/**
 * 宿主给每一份文档（入口页与模型页面一样）注入的观感起点：深浅两套变量 + 上面那几条基础规则。
 * 用 `--pi-*` 变量画的页面自然和宿主同一套灰阶；页面完全不理会它也不会坏。
 */
function themeSheet(theme: "dark" | "light"): string {
	return (
		`<style ${BASE_MARKER}>` +
		`:root{color-scheme:${theme};${BASE_TOKENS}${theme === "dark" ? DARK_TOKENS : LIGHT_TOKENS}}` +
		BASE_RULES +
		"</style>"
	);
}

/**
 * key → html。只是协议 handler 的投递层：真身在会话消息里，会话中枢投影 transcript 时写进来，
 * 删会话时按会话前缀清空。
 */
const cache = new Map<string, string>();

/** 把一份产物的 HTML 放进投递层。 */
export function putArtifact(key: string, html: string): void {
	cache.set(key, html);
}

/** 协议 handler 取正文；没投递过（会话已关、地址被手工拼过）就是 null。 */
export function readArtifact(key: string): string | null {
	return cache.get(key) ?? null;
}

/**
 * 协议 handler 的判断都收在这里（纯函数）：入口页现拼，找得到就拼文档，找不到 404，超限给说明页。
 * 正文超限只在投递层被塞了不该有的东西时才发生——工具与围栏兜底都先按上限校验过。
 */
export type ArtifactResponse = { status: 200 | 404 | 413; body: string };

/** 一份请求该回什么；handler 只负责加响应头。 */
export function artifactResponse(request: ArtifactRequest, theme: "dark" | "light"): ArtifactResponse {
	const html = readArtifact(artifactKey(request.sessionId, request.itemId));
	if (html === null) return { status: 404, body: "No such artifact" };
	if (html.length > MAX_ARTIFACT_BYTES) return { status: 413, body: tooLargePage() };
	return { status: 200, body: composeDocument(html, theme) };
}

/** 会话被删：它名下的产物投递全部失效。 */
export function clearArtifacts(sessionId: string): void {
	const prefix = artifactKey(sessionId, "");
	for (const key of [...cache.keys()]) {
		if (key.startsWith(prefix)) cache.delete(key);
	}
}

/**
 * 把宿主桥接脚本注进模型给的文档：在 `<head>` 之后、否则 `<html>` 之后、都没有就放在最前面。
 * 同时先放一条 `color-scheme`，页面至少跟着深浅色走系统外观。
 */
export function composeDocument(html: string, theme: "dark" | "light"): string {
	if (html.includes(BRIDGE_MARKER)) return html;
	const injection = themeSheet(theme) + bridgeScript(theme);
	const head = tagEnd(html, "head");
	if (head !== -1) return `${html.slice(0, head)}${injection}${html.slice(head)}`;
	const root = tagEnd(html, "html");
	if (root !== -1) return `${html.slice(0, root)}${injection}${html.slice(root)}`;
	// 裸片段：doctype 必须仍是第一个 token，否则文档掉进 quirks mode。
	const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
	if (doctype !== null) return `${html.slice(0, doctype[0].length)}${injection}${html.slice(doctype[0].length)}`;
	return injection + html;
}

/** 帧里那唯一一份桥接：只把消息丢给宿主，不自己调工具、不碰 IPC。 */
function bridgeScript(theme: "dark" | "light"): string {
	return (
		`<script ${BRIDGE_MARKER}>` +
		"(function(){" +
		"var root=document.documentElement;" +
		`if(!root.dataset.theme){root.dataset.theme=${JSON.stringify(theme)};}` +
		"function post(payload){window.parent.postMessage(payload,'*');}" +
		"if(window.pi){return;}" +
		"window.pi={" +
		"submit:function(text){post({source:'pi-artifact',type:'submit',text:String(text)});}," +
		"openExternal:function(url){post({source:'pi-artifact',type:'openExternal',url:String(url)});}," +
		"ready:function(){post({source:'pi-artifact',type:'ready'});}" +
		"};" +
		"})();" +
		"</script>"
	);
}

/** 超过上限时的说明页：界面上只剩一片空白比这更糟，让帧自己说清原因。 */
function tooLargePage(): string {
	const text = `This page is larger than ${Math.round(MAX_ARTIFACT_BYTES / 1024)} KB and was not rendered.`;
	return `<!doctype html><html><head><meta charset="utf-8"><title>Page too large</title>${NOTE_STYLE}</head><body><p>${text}</p></body></html>`;
}

const NOTE_STYLE =
	"<style>body{min-height:100vh;display:flex;align-items:center;justify-content:center}p{margin:24px;max-width:420px;color:var(--pi-muted)}</style>";

/** 某个开标签结束的 `>` 之后那个位置；找不到返回 -1。`<header>` 不算 `<head>` 的匹配。 */
function tagEnd(html: string, tag: "head" | "html"): number {
	const match = new RegExp(`<${tag}[\\s>]`, "i").exec(html);
	if (match === null) return -1;
	const close = html.indexOf(">", match.index);
	return close === -1 ? -1 : close + 1;
}
