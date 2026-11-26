// 沉浸模式在 renderer 侧的处理：iframe 地址、帧内 postMessage 的校验，以及从 transcript 里挑产物。

import type { ArtifactView, TranscriptItem } from "../../shared/contract.ts";

/** 帧里发回宿主的一条消息；不合法的一律丢掉，不进界面。 */
export type ArtifactMessage =
	| { type: "submit"; text: string }
	| { type: "openExternal"; url: string }
	| { type: "ready" };

/** 一帧能替用户说多少字：再长就不是“一句话意图”，而是把整篇正文塞回输入框。 */
const MAX_SUBMIT_CHARS = 8_000;
const MAX_URL_CHARS = 2_000;

/** 校验帧发回的消息：来源标记、类型、正文长度与链接协议都过了才认。 */
export function readArtifactMessage(data: unknown): ArtifactMessage | null {
	if (typeof data !== "object" || data === null) return null;
	const record = data as Record<string, unknown>;
	if (record.source !== "pi-artifact") return null;
	switch (record.type) {
		case "submit": {
			const text = typeof record.text === "string" ? record.text.trim() : "";
			return text.length > 0 && text.length <= MAX_SUBMIT_CHARS ? { type: "submit", text } : null;
		}
		case "openExternal": {
			const url = typeof record.url === "string" ? record.url : "";
			return isHttpUrl(url) && url.length <= MAX_URL_CHARS ? { type: "openExternal", url } : null;
		}
		case "ready":
			return { type: "ready" };
		default:
			return null;
	}
}

/** 一份落地产物和它那一轮的用户消息：舞台的头条要显示这一页在回答什么。 */
export type ArtifactTurn = {
	artifact: ArtifactView;
	/** 触发这一轮的用户消息；会话从别处接过来的（没有对应消息）时为 null。 */
	prompt: Extract<TranscriptItem, { kind: "user" }> | null;
};

/**
 * 按出现顺序列出每份落地产物与它的用户消息。还在流式的那条不算：
 * 模型写半截时舞台仍显示上一版，换帧只发生在整条消息写完之后。
 */
export function artifactTurns(items: readonly TranscriptItem[]): ArtifactTurn[] {
	const turns: ArtifactTurn[] = [];
	let prompt: Extract<TranscriptItem, { kind: "user" }> | null = null;
	for (const item of items) {
		if (item.kind === "user") {
			prompt = item;
			continue;
		}
		if (item.kind !== "assistant" || item.streaming) continue;
		for (const part of item.parts) {
			if (part.type === "artifact") turns.push({ artifact: part.artifact, prompt });
		}
	}
	return turns;
}

/**
 * 当前这一轮（最后一条用户消息之后）有没有落地产物：舞台的“本轮没有 HTML，重试”靠它露出，
 * 会话里有过更早的页面也不算数。
 */
export function turnHasArtifact(items: readonly TranscriptItem[]): boolean {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (!item) continue;
		if (item.kind === "user") return false;
		if (item.kind !== "assistant" || item.streaming) continue;
		if (item.parts.some((part) => part.type === "artifact")) return true;
	}
	return false;
}

/** 源码视图的文本：就是工具收到的那份 HTML，不做格式化。 */
export function artifactSource(artifact: ArtifactView): string {
	return artifact.html;
}

function isHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}
