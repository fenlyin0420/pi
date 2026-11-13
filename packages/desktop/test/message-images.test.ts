// 消息图片的单元测试：按图片块取第 n 张，非用户消息或越界给 null。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { imageViewOf } from "../src/main/message-images.ts";

/** 只关心图片块：测试里直接造消息，正文块用不到真实内容。 */
function userWithImages(...images: { data: string; mimeType: string }[]): AgentMessage {
	return {
		role: "user",
		timestamp: 1,
		content: [{ type: "text", text: "look" }, ...images.map((image) => ({ type: "image" as const, ...image }))],
	} as unknown as AgentMessage;
}

describe("imageViewOf", () => {
	it("图片块按顺序编号，data URL 带上它自己的媒介类型", () => {
		const message = userWithImages({ data: "AAA", mimeType: "image/png" }, { data: "BBB", mimeType: "image/jpeg" });
		expect(imageViewOf(message, 0)).toEqual({
			path: null,
			name: "Image 1",
			dataUrl: "data:image/png;base64,AAA",
		});
		expect(imageViewOf(message, 1)).toEqual({
			path: null,
			name: "Image 2",
			dataUrl: "data:image/jpeg;base64,BBB",
		});
	});

	it("越界的下标和非用户消息都给 null", () => {
		expect(imageViewOf(userWithImages({ data: "AAA", mimeType: "image/png" }), 1)).toBeNull();
		const assistant = { role: "assistant", content: [] } as unknown as AgentMessage;
		expect(imageViewOf(assistant, 0)).toBeNull();
	});
});
