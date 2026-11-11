// 实时预览的一行规则：只在运行中出现，取最后一条 assistant 的最后一行的尾部。

import { describe, expect, it } from "vitest";
import { livePreview } from "../src/renderer/components/LivePreview.tsx";
import type { TranscriptItem } from "../src/shared/contract.ts";

function assistant(parts: Extract<TranscriptItem, { kind: "assistant" }>["parts"], streaming = true): TranscriptItem {
	return { kind: "assistant", id: "a", parts, timestamp: 0, streaming, model: null, usage: null, error: null };
}

const user: TranscriptItem = { kind: "user", id: "u", text: "hi", timestamp: 0, imageCount: 0 };

describe("livePreview", () => {
	it("空闲时不显示", () => {
		expect(livePreview([user, assistant([{ type: "text", text: "done" }])], "idle")).toBeNull();
	});

	it("还没有内容时说在等模型", () => {
		expect(livePreview([user], "running")).toBe("Waiting for the model…");
		expect(livePreview([user, assistant([])], "running")).toBe("Waiting for the model…");
	});

	it("取最后一段内容的最后一行", () => {
		const items = [user, assistant([{ type: "thinking", text: "plan\nfirst step" }])];
		expect(livePreview(items, "running")).toBe("first step");
	});

	it("工具在跑时显示那个工具", () => {
		const call = {
			id: "t",
			name: "bash",
			state: "running" as const,
			summary: "bash npm test",
			argsText: "",
			resultText: "",
			diff: null,
			durationMs: null,
		};
		const items = [
			user,
			assistant([
				{ type: "text", text: "Running the suite" },
				{ type: "tool", call },
			]),
		];
		expect(livePreview(items, "running")).toBe("bash npm test");
	});

	it("过长时保留尾部", () => {
		const long = "x".repeat(200);
		const items = [user, assistant([{ type: "text", text: long }])];
		const line = livePreview(items, "running") ?? "";
		expect(line.startsWith("…")).toBe(true);
		expect(line.length).toBe(121);
	});
});
