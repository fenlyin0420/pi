// pi-artifact 协议的地址形状：main 端解析、renderer 端拼装共用一份，两边的格式不会各走各的。

/** 渲染 HTML 产物用的自定义协议；它的响应头带独立 CSP，沙箱帧因此能跑内联脚本。 */
export const ARTIFACT_SCHEME = "pi-artifact";

/** 一条协议请求指向的产物：哪一条会话里的哪一份。 */
export type ArtifactRequest = { sessionId: string; itemId: string };

/** 一份产物在协议里的地址：会话 + 那条助手消息里的 artifact id。 */
export function artifactKey(sessionId: string, itemId: string): string {
	return `${ARTIFACT_SCHEME}://session/${encodeURIComponent(sessionId)}/${encodeURIComponent(itemId)}`;
}

/** iframe 的 src：主题进查询串，换主题就换地址，帧随之整份重载。 */
export function artifactUrl(sessionId: string, itemId: string, theme: "dark" | "light"): string {
	return `${artifactKey(sessionId, itemId)}?theme=${theme}`;
}

/** 协议 handler 的入口：只认 `/session/<sessionId>/<itemId>`，别的形状一律 null。 */
export function parseArtifactRequest(url: URL): ArtifactRequest | null {
	if (url.protocol !== `${ARTIFACT_SCHEME}:` || url.hostname !== "session") return null;
	const [rawSession, rawItem, ...rest] = url.pathname.split("/").filter(Boolean);
	if (!rawSession || !rawItem || rest.length > 0) return null;
	try {
		return { sessionId: decodeURIComponent(rawSession), itemId: decodeURIComponent(rawItem) };
	} catch {
		// 百分号编码坏了：这条地址不是我们发出去的，当没找到处理。
		return null;
	}
}
