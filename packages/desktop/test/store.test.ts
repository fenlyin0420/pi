// renderer 事件折叠的单元测试：快照、结构更新、流式增量、模型列表、提示与菜单动作。

import { describe, expect, it } from "vitest";
import { INITIAL_STATE, reduceEvent } from "../src/renderer/store.ts";
import type { DesktopState, SessionSummary, TranscriptItem } from "../src/shared/contract.ts";

const SESSION: SessionSummary = {
	id: "s1",
	path: "/tmp/s1.jsonl",
	workspace: "/tmp",
	title: "Session",
	createdAt: 1,
	updatedAt: 2,
	messageCount: 2,
	pinned: false,
	status: "idle",
	unread: false,
	model: null,
	preview: "",
};

const ASSISTANT: TranscriptItem = {
	kind: "assistant",
	id: "msg-1",
	parts: [{ type: "text", text: "he" }],
	timestamp: 2,
	streaming: true,
	model: "test/m1",
	usage: null,
	interrupted: false,
	error: null,
};

function state(): DesktopState {
	return {
		platform: "linux",
		theme: "dark",
		workspace: "/tmp",
		workspaces: [{ path: "/tmp", name: "tmp" }],
		sessions: [SESSION],
		activeSessionId: "s1",
		transcript: [ASSISTANT],
		agent: {
			model: "test/m1",
			modelName: "M1",
			thinkingLevel: "medium",
			reasoning: true,
			status: "running",
			activity: null,
			usage: null,
			queued: { steering: [], followUp: [] },
		},
		settings: {
			theme: "dark",
			fontScale: 1,
			density: "comfortable",
			showThinking: true,
			showToolDetails: false,
			showUsage: true,
			sidebarWidth: 272,
			sidebarCollapsed: false,
			diffPanelWidth: 480,
			workspaces: ["/tmp"],
			activeWorkspace: "/tmp",
			pinnedSessions: [],
		},
	};
}

describe("reduceEvent", () => {
	it("state 事件整体替换 desktop", () => {
		const next = reduceEvent(INITIAL_STATE, { type: "state", state: state() });
		expect(next.desktop?.workspace).toBe("/tmp");
	});

	it("transcript 事件只接受活动会话的结构更新", () => {
		const base = reduceEvent(INITIAL_STATE, { type: "state", state: state() });
		const items: TranscriptItem[] = [{ kind: "notice", id: "n", level: "info", text: "x", timestamp: 3 }];
		expect(reduceEvent(base, { type: "transcript", sessionId: "other", items }).desktop?.transcript).toEqual([
			ASSISTANT,
		]);
		expect(reduceEvent(base, { type: "transcript", sessionId: "s1", items }).desktop?.transcript).toEqual(items);
	});

	it("流式内容也走 transcript 快照，整条替换", () => {
		const base = reduceEvent(INITIAL_STATE, { type: "state", state: state() });
		const streaming: TranscriptItem[] = [
			{
				kind: "assistant",
				id: "msg-1",
				parts: [{ type: "thinking", text: "hmm" }],
				timestamp: 2,
				streaming: true,
				model: "p/m",
				usage: null,
				interrupted: false,
				error: null,
			},
		];
		const next = reduceEvent(base, { type: "transcript", sessionId: "s1", items: streaming });
		expect(next.desktop?.transcript).toEqual(streaming);
	});

	it("models 与 window 事件各自更新一个字段", () => {
		const base = reduceEvent(INITIAL_STATE, { type: "state", state: state() });
		const withModels = reduceEvent(base, {
			type: "models",
			models: [
				{
					key: "p/m",
					provider: "p",
					id: "m",
					name: "M",
					reasoning: false,
					contextWindow: 1,
					maxTokens: 1,
					available: true,
				},
			],
		});
		expect(withModels.models).toHaveLength(1);
		expect(reduceEvent(base, { type: "window", maximized: true }).maximized).toBe(true);
	});

	it("toast 累积并最多保留四条", () => {
		let next = INITIAL_STATE;
		for (let index = 0; index < 5; index += 1) {
			next = reduceEvent(next, { type: "toast", level: "error", message: `e${index}` });
		}
		expect(next.toasts).toHaveLength(4);
		expect(next.toasts.at(-1)?.message).toBe("e4");
	});

	it("files 事件不改变主状态", () => {
		const base = reduceEvent(INITIAL_STATE, { type: "state", state: state() });
		expect(reduceEvent(base, { type: "files", requestId: 1, files: ["a.ts"] })).toBe(base);
	});

	it("menu 事件用递增的 seq 标记同一动作的重复触发", () => {
		const first = reduceEvent(INITIAL_STATE, { type: "menu", action: "settings" });
		const second = reduceEvent(first, { type: "menu", action: "settings" });
		expect(second.menu?.action).toBe("settings");
		expect(second.menu?.seq).toBe((first.menu?.seq ?? 0) + 1);
	});

	it("draftRestore 用递增的 seq 标记同一条文字的重复撒回", () => {
		const first = reduceEvent(INITIAL_STATE, { type: "draftRestore", sessionId: "s1", text: "改一下" });
		const second = reduceEvent(first, { type: "draftRestore", sessionId: "s1", text: "改一下" });
		expect(second.draftRestore?.text).toBe("改一下");
		expect(second.draftRestore?.seq).toBe((first.draftRestore?.seq ?? 0) + 1);
	});

	it("队列随 state 快照到达，不在 transcript 里", () => {
		const snapshot = state();
		const queued = { steering: ["先别改 schema"], followUp: ["写完补测试"] };
		const next = reduceEvent(INITIAL_STATE, {
			type: "state",
			state: { ...snapshot, agent: { ...snapshot.agent, queued } },
		});
		expect(next.desktop?.agent.queued).toEqual(queued);
		expect(next.desktop?.transcript).toEqual(snapshot.transcript);
	});
});
