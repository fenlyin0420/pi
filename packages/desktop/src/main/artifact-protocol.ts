// pi-artifact 协议的 Electron 接线：注册特权 scheme，并在 ready 之后接管它的请求。
// 拆出来是为了让 artifacts.ts 可以被单测直接 import（协议 API 只在 Electron main 里存在）。

import { protocol } from "electron";
import { parseArtifactRequest } from "../shared/artifact-url.ts";
import { ARTIFACT_CSP, ARTIFACT_SCHEME, artifactResponse } from "./artifacts.ts";

/** 文档响应的统一头：独立 CSP 是沙箱之外的第二层边界。 */
const DOCUMENT_HEADERS = {
	"content-type": "text/html; charset=utf-8",
	"content-security-policy": ARTIFACT_CSP,
};

const TEXT_HEADERS = { "content-type": "text/plain; charset=utf-8" };

/**
 * 注册 pi-artifact。必须在 app ready 之前调用：Chromium 只认启动前声明的特权 scheme，
 * standard + secure 让 iframe 里的地址是正常来源，supportFetchAPI 留给页面自己的 data: 读取。
 */
export function registerArtifactScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: ARTIFACT_SCHEME,
			privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
		},
	]);
}

/** ready 之后、建窗口之前调用：把缓存里的产物拼成文档交给帧。 */
export function installArtifactProtocol(deps: { theme(): "dark" | "light" }): void {
	protocol.handle(ARTIFACT_SCHEME, (request) => {
		// 请求地址来自 wire（帧自己也可能拼一个）：解析失败按坏请求处理，不把异常抛给协议层。
		let parsed: ReturnType<typeof parseArtifactRequest> = null;
		try {
			parsed = parseArtifactRequest(new URL(request.url));
		} catch {
			return new Response("Bad request", { status: 400, headers: TEXT_HEADERS });
		}
		if (!parsed) return new Response("Not found", { status: 404, headers: TEXT_HEADERS });
		const { status, body } = artifactResponse(parsed, deps.theme());
		// 404 是纯文本；413 的说明页本身是网页，照样用文档头。
		return new Response(body, { status, headers: status === 404 ? TEXT_HEADERS : DOCUMENT_HEADERS });
	});
}
