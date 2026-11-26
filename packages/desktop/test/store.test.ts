// renderer 事件折叠的单元测试：快照、结构更新、流式增量、模型列表、提示与菜单动作。

import { describe, expect, it } from "vitest";
import { INITIAL_STATE, reduceEvent } from "../src/renderer/store.ts";
import type { AskRequest, DesktopState, SessionSummary, TranscriptItem } from "../src/shared/contract.ts";

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
	awaitingAsk: false,
	model: null,
	preview: "",
};

const ASK_A: AskRequest = {
	flowId: "flow-a",
	title: "Pick one",
	createdAt: 5,
	questions: [
		{
			id: "q1",
			label: "Color",
			prompt: "Which color?",
			type: "single",
			required: true,
			freeform: false,
			options: [{ value: "green", label: "Green" }],
		},
	],
};

const ASK_B: AskRequest = { ...ASK_A, flowId: "flow-b" };

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
		todos: [],
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
			collapsedGroups: [],
			diffPanelWidth: 480,
			workspaces: ["/tmp"],
			activeWorkspace: "/tmp",
			issuesConcurrency: 3,
			pinnedSessions: [],
			immersiveSessions: [],
		},
		issues: [],
		issueRun: { running: [], pending: 0, paused: false },
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

	it("ask 按 flowId 入列、按 flowId 出列，两个会话的提问互不覆盖", () => {
		const first = reduceEvent(INITIAL_STATE, { type: "ask", sessionId: "s1", request: ASK_A });
		const second = reduceEvent(first, { type: "ask", sessionId: "s2", request: ASK_B });
		expect(second.asks.map((entry) => entry.sessionId)).toEqual(["s1", "s2"]);
		// 关掉 s1 那一份，s2 那一份必须还在：从前单槽的 ask 在这里会丢掉一个答案。
		const closed = reduceEvent(second, { type: "askClosed", sessionId: "s1", flowId: ASK_A.flowId });
		expect(closed.asks.map((entry) => entry.request.flowId)).toEqual([ASK_B.flowId]);
	});

	it("同一个 flowId 重发只换那一份，不叠两张卡", () => {
		const first = reduceEvent(INITIAL_STATE, { type: "ask", sessionId: "s1", request: ASK_A });
		const again = reduceEvent(first, { type: "ask", sessionId: "s1", request: { ...ASK_A, title: "改名" } });
		expect(again.asks).toHaveLength(1);
		expect(again.asks[0]?.request.title).toBe("改名");
	});

	it("关一份不存在的 flow 不改状态对象", () => {
		const base = reduceEvent(INITIAL_STATE, { type: "ask", sessionId: "s1", request: ASK_A });
		expect(reduceEvent(base, { type: "askClosed", sessionId: "s1", flowId: "other" })).toBe(base);
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
