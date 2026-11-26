// renderer 侧帧消息的校验：来源标记、类型白名单、正文长度与链接协议。

import { describe, expect, it } from "vitest";
import { artifactTurns, readArtifactMessage, turnHasArtifact } from "../src/renderer/lib/artifact.ts";
import type { ArtifactView, TranscriptItem } from "../src/shared/contract.ts";

describe("readArtifactMessage", () => {
	it("带来源标记的 submit 读出正文", () => {
		expect(readArtifactMessage({ source: "pi-artifact", type: "submit", text: "  add one  " })).toEqual({
			type: "submit",
			text: "add one",
		});
	});

	it("没有来源标记或来源不对的消息直接丢掉", () => {
		expect(readArtifactMessage({ type: "submit", text: "x" })).toBeNull();
		expect(readArtifactMessage({ source: "other", type: "submit", text: "x" })).toBeNull();
		expect(readArtifactMessage("submit")).toBeNull();
		expect(readArtifactMessage(null)).toBeNull();
	});

	it("未知类型与非字符串正文被拒绝", () => {
		expect(readArtifactMessage({ source: "pi-artifact", type: "runTool", text: "x" })).toBeNull();
		expect(readArtifactMessage({ source: "pi-artifact", type: "submit", text: 7 })).toBeNull();
		expect(readArtifactMessage({ source: "pi-artifact", type: "submit", text: "   " })).toBeNull();
	});

	it("submit 正文超过 8k 时丢掉", () => {
		expect(readArtifactMessage({ source: "pi-artifact", type: "submit", text: "a".repeat(8_000) })).not.toBeNull();
		expect(readArtifactMessage({ source: "pi-artifact", type: "submit", text: "a".repeat(8_001) })).toBeNull();
	});

	it("openExternal 只放行 http(s)", () => {
		expect(readArtifactMessage({ source: "pi-artifact", type: "openExternal", url: "https://example.com" })).toEqual({
			type: "openExternal",
			url: "https://example.com",
		});
		for (const url of ["file:///etc/passwd", "javascript:alert(1)", "pi-artifact://session/a/b", "nope", ""]) {
			expect(readArtifactMessage({ source: "pi-artifact", type: "openExternal", url })).toBeNull();
		}
	});

	it("ready 不带载荷", () => {
		expect(readArtifactMessage({ source: "pi-artifact", type: "ready" })).toEqual({ type: "ready" });
	});
});

function artifact(id: string): ArtifactView {
	return { id, title: id, html: "<p>x</p>", source: "tool" };
}

function turn(id: string, artifacts: ArtifactView[], streaming = false): TranscriptItem {
	return {
		kind: "assistant",
		id,
		parts: artifacts.map((entry) => ({ type: "artifact" as const, artifact: entry })),
		timestamp: 1,
		streaming,
		model: null,
		usage: null,
		interrupted: false,
		error: null,
	};
}

const USER: TranscriptItem = {
	kind: "user",
	id: "u1",
	text: "make a page",
	timestamp: 1,
	imageCount: 0,
	files: [],
	messageIndex: 0,
};

describe("artifactTurns / turnHasArtifact", () => {
	it("流式中的产物不算：模型写半截时不换文档", () => {
		const items = [USER, turn("a1", [artifact("one")]), turn("a2", [artifact("two")], true)];
		expect(artifactTurns(items).map((entry) => entry.artifact.id)).toEqual(["one"]);
	});

	it("每份产物带上触发它的用户消息", () => {
		const next: TranscriptItem = { ...USER, id: "u2", text: "change it" };
		const items = [USER, turn("a1", [artifact("one")]), next, turn("a2", [artifact("two")])];
		const turns = artifactTurns(items);
		expect(turns).toHaveLength(2);
		expect(turns[0]?.prompt?.id).toBe("u1");
		expect(turns[1]?.prompt?.id).toBe("u2");
	});

	it("会话从别处接过来（前面没有用户消息）时 prompt 为 null", () => {
		expect(artifactTurns([turn("a1", [artifact("one")])])[0]?.prompt).toBeNull();
	});

	it("同一轮里有两份产物时两份都算，各自挂同一条用户消息", () => {
		const turns = artifactTurns([USER, turn("a1", [artifact("one"), artifact("two")])]);
		expect(turns.map((entry) => entry.artifact.id)).toEqual(["one", "two"]);
		expect(turns.every((entry) => entry.prompt?.id === "u1")).toBe(true);
	});

	it("本轮没有产物时 turnHasArtifact 为 false，哪怕更早有页面", () => {
		expect(turnHasArtifact([USER, turn("a1", [artifact("one")])])).toBe(true);
		const nextTurn: TranscriptItem = { ...USER, id: "u2", text: "change it" };
		expect(turnHasArtifact([USER, turn("a1", [artifact("one")]), nextTurn])).toBe(false);
		expect(turnHasArtifact([USER, turn("a1", [artifact("one")]), nextTurn, turn("a2", [artifact("two")])])).toBe(
			true,
		);
	});

	it("空的 transcript 既没有产物也没有本轮产物", () => {
		expect(artifactTurns([])).toEqual([]);
		expect(turnHasArtifact([])).toBe(false);
	});
});
