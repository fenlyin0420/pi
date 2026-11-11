// main 进程的会话中枢：打开过的会话各自保留一个活 AgentSession，事件在这里合并后推给 renderer。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	createEventBus,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentStatus,
	AgentView,
	AskAnswer,
	AskRequest,
	DesktopCommand,
	DesktopEvent,
	DesktopSettings,
	DesktopState,
	ModelView,
	Platform,
	PromptImage,
	ResolvedTheme,
	SessionSummary,
	ThinkingLevel,
	TranscriptItem,
	UsageSummary,
} from "../shared/contract.ts";
import { flowIdOf, PI_ASK_COMPLETED, PI_ASK_STARTED, PI_ASK_SUBMIT, toAskRequest, toSubmitPayload } from "./ask.ts";
import { deleteSessionFile, listSessionSummaries, renameSessionFile, toSessionSummary } from "./session-files.ts";
import type { SettingsStore } from "./settings.ts";
import { itemIdAt, previewLine, toTranscriptItems } from "./transcript.ts";

/** 结构变化和流式增量的合并窗口：一帧一次 IPC，token 不再逐条过网。 */
const TRANSCRIPT_FLUSH_MS = 32;
/** 快照合并窗口；会话列表和状态变化不需要每事件一份。 */
const STATE_FLUSH_MS = 48;
const UNTITLED = "New session";

export type HostDeps = {
	settings: SettingsStore;
	platform: Platform;
	theme(): ResolvedTheme;
	emit(event: DesktopEvent): void;
	/** 目录选择由 index 实现，返回 null 表示用户取消。 */
	pickDirectory(): Promise<string | null>;
};

type LiveSession = {
	id: string;
	agent: AgentSession;
	manager: SessionManager;
	status: AgentStatus;
	toolStartedAt: Map<string, number>;
	toolDurations: Map<string, number>;
	items: TranscriptItem[];
	transcriptDirty: boolean;
	/** 正在生成的那条 assistant 消息；提交前它不在 agent.messages 里，界面靠它先显示。 */
	partial: AgentMessage | null;
	unsubscribe: () => void;
};

/**
 * 会话中枢。一个会话从打开到应用退出一直活着：切走只改变 activeId，正在跑的任务继续跑，
 * 侧栏的忙碌状态也跟着各自的会话走。
 */
export class SessionHost {
	private readonly deps: HostDeps;
	private cwd: string;
	private readonly live = new Map<string, LiveSession>();
	private summaries: SessionSummary[] = [];
	private activeId: string | null = null;
	private transcriptTimer: NodeJS.Timeout | null = null;
	private stateTimer: NodeJS.Timeout | null = null;
	private structureDirty = false;
	private stateDirty = false;
	/** 扩展与宿主共享的事件总线；pi-ask 的提问和答案都走它。 */
	private readonly bus = createEventBus();
	private pendingAsk: AskRequest | null = null;

	constructor(cwd: string, deps: HostDeps) {
		this.cwd = cwd;
		this.deps = deps;
		this.bus.on(PI_ASK_STARTED, (data) => this.onAskStarted(data));
		this.bus.on(PI_ASK_COMPLETED, (data) => this.onAskCompleted(data));
	}

	getCwd(): string {
		return this.cwd;
	}

	/** 当前渲染所需的全部数据；transcript 取的是活动会话的最新投影。 */
	buildState(): DesktopState {
		const settings = this.deps.settings.get();
		const active = this.activeSession();
		return {
			platform: this.deps.platform,
			theme: this.deps.theme(),
			cwd: this.cwd,
			recentProjects: settings.recentProjects.map((path) => ({
				path,
				name: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
				lastOpenedAt: 0,
			})),
			sessions: this.summaries,
			activeSessionId: this.activeId,
			transcript: active ? this.transcriptOf(active) : [],
			agent: this.agentView(active),
			settings,
		};
	}

	/** 首次装载：读会话目录，并恢复最近一个会话，让窗口一打开就是上次的位置。 */
	async start(): Promise<void> {
		await this.refreshSessions();
		const recent = this.summaries[0];
		if (recent?.path) await this.openById(recent.id, recent.path);
		this.flushNow();
	}

	async handle(command: DesktopCommand): Promise<void> {
		switch (command.type) {
			case "refreshSessions":
				await this.refreshSessions();
				return this.flushNow();
			case "openProject": {
				const directory = await this.deps.pickDirectory();
				if (directory) await this.setCwd(directory);
				return;
			}
			case "openRecentProject":
				await this.setCwd(command.path);
				return;
			case "newSession":
				await this.createSession();
				return this.flushNow();
			case "openSession":
				await this.openById(command.id);
				return this.flushNow();
			case "prompt":
				await this.prompt(command.text, command.images ?? []);
				return;
			case "steer":
				await this.steer(command.text);
				return;
			case "abort":
				await this.abort();
				return;
			case "renameSession":
				await this.rename(command.id, command.title);
				return;
			case "deleteSession":
				await this.remove(command.id);
				return;
			case "pinSession":
				this.pin(command.id, command.pinned);
				return;
			case "updateSettings":
				this.updateSettings(command.patch);
				return;
			case "askAnswer":
				this.answerAsk(command.flowId, command.answers, command.note);
				return;
			case "setModel":
				await this.setModel(command.model);
				return;
			case "setThinkingLevel":
				this.setThinkingLevel(command.level);
				return;
			default:
				// 窗口与文件系统命令由 index 处理，host 不认识的一律忽略。
				return;
		}
	}

	dispose(): void {
		for (const session of this.live.values()) {
			session.unsubscribe();
			session.agent.dispose();
		}
		this.live.clear();
	}

	/** 模型列表：模型选择器打开时取一次，凭据变化后重取。 */
	listModels(): void {
		this.deps.emit({ type: "models", models: buildModelViews(this.activeSession()?.agent) });
	}

	/** 切换项目目录：旧目录的会话保留在内存里，侧栏换成新目录。 */
	private async setCwd(cwd: string): Promise<void> {
		if (cwd === this.cwd) return;
		this.cwd = cwd;
		this.activeId = null;
		await this.refreshSessions();
		this.deps.settings.rememberProject(cwd);
		if (this.summaries[0]?.path) await this.openById(this.summaries[0].id, this.summaries[0].path);
		this.flushNow();
	}

	private activeSession(): LiveSession | undefined {
		return this.activeId ? this.live.get(this.activeId) : undefined;
	}

	private async createSession(): Promise<LiveSession> {
		const live = await this.createLive(SessionManager.create(this.cwd));
		this.activeId = live.id;
		this.summaries = upsertSummary(this.summaries, this.summaryOf(live));
		this.markState();
		return live;
	}

	/** 按 id 打开；已活着的会话直接切换，不重新加载磁盘。 */
	private async openById(id: string, path?: string): Promise<void> {
		const existing = this.live.get(id);
		if (existing) {
			this.activeId = existing.id;
			existing.transcriptDirty = true;
			this.markStructure();
			this.markState();
			return;
		}
		const target = path ?? this.summaries.find((session) => session.id === id)?.path;
		if (!target) return;
		const live = await this.createLive(SessionManager.open(target));
		this.activeId = live.id;
		this.markStructure();
		this.markState();
	}

	private async createLive(manager: SessionManager): Promise<LiveSession> {
		// 总线由宿主创建并交给扩展：pi-ask 的 started/submit 两个方向都落在同一个通道上。
		const services = await createAgentSessionServices({
			cwd: this.cwd,
			resourceLoaderOptions: { eventBus: this.bus },
		});
		const { session, modelFallbackMessage } = await createAgentSessionFromServices({
			services,
			sessionManager: manager,
		});
		// 对扩展而言我们是“没有终端、但有传输”的宿主：pi-ask 据此走事件契约而不是 TUI 组件。
		await session.bindExtensions({ mode: "rpc" });
		if (modelFallbackMessage) this.notify("warning", modelFallbackMessage);
		const live: LiveSession = {
			id: session.sessionId,
			agent: session,
			manager,
			status: "idle",
			toolStartedAt: new Map(),
			toolDurations: new Map(),
			items: [],
			transcriptDirty: true,
			partial: null,
			unsubscribe: () => {},
		};
		live.unsubscribe = session.subscribe((event) => this.onSessionEvent(live, event));
		this.live.set(live.id, live);
		return live;
	}

	private async prompt(text: string, images: readonly PromptImage[]): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed && images.length === 0) return;
		const live = this.activeSession() ?? (await this.createSession());
		const payload = images.map(toImageContent);
		try {
			if (live.agent.isStreaming) {
				await live.agent.steer(trimmed, payload);
			} else {
				live.status = "running";
				this.markState();
				// prompt 会等到整轮结束；不阻塞 IPC 返回，错误交给下面统一上报。
				void live.agent.prompt(trimmed, { images: payload }).catch((error: unknown) => this.report(live, error));
			}
		} catch (error) {
			this.report(live, error);
		}
		this.markStructure();
		this.scheduleTranscriptFlush();
	}

	private async steer(text: string): Promise<void> {
		const live = this.activeSession();
		const trimmed = text.trim();
		if (!live || !trimmed) return;
		try {
			await live.agent.steer(trimmed);
		} catch (error) {
			this.report(live, error);
		}
	}

	private async abort(): Promise<void> {
		const live = this.activeSession();
		if (!live) return;
		await live.agent.abort();
		this.markState();
	}

	private async rename(id: string, title: string): Promise<void> {
		const name = title.trim();
		if (!name) return;
		const live = this.live.get(id);
		if (live) {
			live.manager.appendSessionInfo(name);
		} else {
			const path = this.summaries.find((session) => session.id === id)?.path;
			if (!path) return;
			renameSessionFile(path, name);
		}
		await this.refreshSessions();
		this.flushNow();
	}

	private async remove(id: string): Promise<void> {
		const live = this.live.get(id);
		const path = live?.agent.sessionFile ?? this.summaries.find((session) => session.id === id)?.path;
		if (live) {
			live.unsubscribe();
			live.agent.dispose();
			this.live.delete(id);
			if (this.activeId === id) this.activeId = null;
		}
		if (path) {
			try {
				deleteSessionFile(path);
			} catch (error) {
				this.notify("error", `Failed to delete session: ${messageOf(error)}`);
			}
		}
		const settings = this.deps.settings.get();
		if (settings.pinnedSessions.includes(id)) {
			this.deps.settings.update({ pinnedSessions: settings.pinnedSessions.filter((entry) => entry !== id) });
		}
		await this.refreshSessions();
		this.flushNow();
	}

	private pin(id: string, pinned: boolean): void {
		const settings = this.deps.settings.get();
		const next = pinned
			? [...new Set([id, ...settings.pinnedSessions])]
			: settings.pinnedSessions.filter((entry) => entry !== id);
		this.deps.settings.update({ pinnedSessions: next });
		this.summaries = this.summaries.map((session) => (session.id === id ? { ...session, pinned } : session));
		this.markState();
	}

	private updateSettings(patch: Partial<DesktopSettings>): void {
		this.deps.settings.update(patch);
		this.markState();
	}

	private async setModel(key: string): Promise<void> {
		const live = this.activeSession();
		if (!live) return;
		const model = live.agent.modelRuntime
			.getModels()
			.find((candidate) => `${candidate.provider}/${candidate.id}` === key);
		if (!model) {
			this.notify("error", `Unknown model: ${key}`);
			return;
		}
		try {
			await live.agent.setModel(model, { persist: true });
			this.listModels();
			this.markState();
		} catch (error) {
			this.report(live, error);
		}
	}

	private setThinkingLevel(level: ThinkingLevel): void {
		const live = this.activeSession();
		if (!live) return;
		try {
			live.agent.setThinkingLevel(level, { persist: true });
			this.markState();
		} catch (error) {
			this.report(live, error);
		}
	}

	/** 目录下的会话 + 内存里还没落盘的会话，按最近修改排序。 */
	private async refreshSessions(): Promise<void> {
		const pinned = new Set(this.deps.settings.get().pinnedSessions);
		let disk: SessionSummary[] = [];
		try {
			disk = await listSessionSummaries(this.cwd, pinned);
		} catch (error) {
			this.notify("error", `Failed to list sessions: ${messageOf(error)}`);
		}
		const merged = new Map(disk.map((session) => [session.id, session]));
		for (const live of this.live.values()) {
			const base = merged.get(live.id);
			merged.set(live.id, this.summaryOf(live, base));
		}
		this.summaries = [...merged.values()].sort(compareSessions);
		this.markState();
	}

	private summaryOf(live: LiveSession, base?: SessionSummary): SessionSummary {
		const model = live.agent.model;
		if (base) {
			return {
				...base,
				status: live.status,
				model: model ? `${model.provider}/${model.id}` : base.model,
				pinned: this.deps.settings.get().pinnedSessions.includes(live.id),
			};
		}
		const messages = live.agent.messages;
		const lastText =
			[...messages]
				.reverse()
				.map((message) => textOf(message))
				.find((text) => text.length > 0) ?? "";
		return {
			id: live.id,
			path: live.agent.sessionFile ?? null,
			title: live.manager.getSessionName()?.trim() || titleOf(messages) || UNTITLED,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messageCount: messages.length,
			pinned: this.deps.settings.get().pinnedSessions.includes(live.id),
			status: live.status,
			model: model ? `${model.provider}/${model.id}` : null,
			preview: previewLine(lastText),
		};
	}

	private transcriptOf(live: LiveSession): TranscriptItem[] {
		if (live.transcriptDirty) {
			live.items = toTranscriptItems(live.agent.messages, {
				streamingIndex: null,
				toolDurations: live.toolDurations,
			});
			live.transcriptDirty = false;
		}
		if (!live.partial) return live.items;
		// 未提交的那条消息单独投影：id 用它将来的下标，落地成正式消息时界面不会重挂。
		const [streaming] = toTranscriptItems([live.partial], {
			streamingIndex: 0,
			toolDurations: live.toolDurations,
		});
		if (!streaming) return live.items;
		return [...live.items, { ...streaming, id: itemIdAt(live.agent.messages.length) }];
	}

	private agentView(live: LiveSession | undefined): AgentView {
		const model = live?.agent.model;
		return {
			model: model ? `${model.provider}/${model.id}` : null,
			modelName: model?.name ?? null,
			thinkingLevel: live?.agent.thinkingLevel ?? "medium",
			reasoning: model?.reasoning ?? false,
			status: live?.status ?? "idle",
			usage: live ? usageOf(live.agent) : null,
		};
	}

	private onSessionEvent(live: LiveSession, event: AgentSessionEvent): void {
		switch (event.type) {
			case "message_update":
				// 每个流式帧带上这条消息的最新快照：它还没进 agent.messages，界面靠它边生成边显示。
				live.partial = event.message;
				this.structureDirty = true;
				this.scheduleTranscriptFlush();
				return;
			case "message_start":
			case "message_end":
			case "turn_start":
			case "turn_end":
			case "queue_update":
				// 消息落地（或被丢弃）：收起流式快照，让已提交的消息自己占位。
				live.partial = null;
				this.markStructure();
				this.scheduleTranscriptFlush();
				if (event.type === "message_end") void this.refreshSessionsQuietly();
				return;
			case "tool_execution_start":
				live.toolStartedAt.set(event.toolCallId, Date.now());
				this.markStructure();
				this.scheduleTranscriptFlush();
				return;
			case "tool_execution_update":
				this.markStructure();
				this.scheduleTranscriptFlush();
				return;
			case "tool_execution_end": {
				const startedAt = live.toolStartedAt.get(event.toolCallId);
				if (startedAt !== undefined) {
					live.toolDurations.set(event.toolCallId, Date.now() - startedAt);
					live.toolStartedAt.delete(event.toolCallId);
				}
				this.markStructure();
				this.scheduleTranscriptFlush();
				return;
			}
			case "agent_end":
				if (!live.agent.isStreaming) live.status = "idle";
				live.partial = null;
				this.markStructure();
				this.markState();
				this.flushNow();
				return;
			case "agent_settled":
				live.status = "idle";
				live.partial = null;
				this.markStructure();
				this.markState();
				this.flushNow();
				void this.refreshSessionsQuietly();
				return;
			case "session_info_changed":
				void this.refreshSessionsQuietly();
				return;
			case "thinking_level_changed":
				this.markState();
				return;
			case "compaction_start":
				this.notify("info", `Compaction started (${event.reason})`);
				this.markStructure();
				return;
			case "compaction_end": {
				const label = event.aborted ? "Compaction cancelled" : "Compaction finished";
				this.notify(event.errorMessage ? "error" : "info", event.errorMessage ?? label);
				this.markStructure();
				return;
			}
			case "auto_retry_start":
				this.notify("warning", `Retrying (${event.attempt}/${event.maxAttempts}): ${event.errorMessage}`);
				return;
			case "auto_retry_end":
				if (!event.success && event.finalError) this.notify("error", event.finalError);
				return;
			default:
				return;
		}
	}

	private markStructure(): void {
		const live = this.activeSession();
		if (!live) return;
		live.transcriptDirty = true;
		this.structureDirty = true;
	}

	private markState(): void {
		this.stateDirty = true;
		if (this.stateTimer) return;
		this.stateTimer = setTimeout(() => {
			this.stateTimer = null;
			if (this.stateDirty) this.emitState();
		}, STATE_FLUSH_MS);
	}

	private scheduleTranscriptFlush(): void {
		if (this.transcriptTimer) return;
		this.transcriptTimer = setTimeout(() => {
			this.transcriptTimer = null;
			this.flushTranscript();
		}, TRANSCRIPT_FLUSH_MS);
	}

	/** 先发结构快照：流式内容也走快照，renderer 只认这一种。 */
	private flushTranscript(): void {
		const live = this.activeSession();
		if (!live || !this.structureDirty) return;
		this.structureDirty = false;
		this.deps.emit({ type: "transcript", sessionId: live.id, items: this.transcriptOf(live) });
	}

	private flushNow(): void {
		if (this.transcriptTimer) {
			clearTimeout(this.transcriptTimer);
			this.transcriptTimer = null;
		}
		if (this.stateTimer) {
			clearTimeout(this.stateTimer);
			this.stateTimer = null;
		}
		this.flushTranscript();
		this.emitState();
	}

	private emitState(): void {
		this.stateDirty = false;
		this.deps.emit({ type: "state", state: this.buildState() });
	}

	private async refreshSessionsQuietly(): Promise<void> {
		await this.refreshSessions();
		this.markState();
	}

	private report(live: LiveSession, error: unknown): void {
		live.status = live.agent.isStreaming ? "running" : "idle";
		this.notify("error", messageOf(error));
		this.markStructure();
		this.markState();
	}

	/** pi-ask 开始提问：转成界面契约推给 renderer，同一时刻只保留一份。 */
	private onAskStarted(data: unknown): void {
		const request = toAskRequest(data);
		if (!request) return;
		this.pendingAsk = request;
		this.deps.emit({ type: "ask", request });
	}

	/** 提问结束（提交、取消或超时）：让界面上那张卡自己收起。 */
	private onAskCompleted(data: unknown): void {
		const flowId = flowIdOf(data);
		if (!flowId) return;
		if (this.pendingAsk?.flowId === flowId) this.pendingAsk = null;
		this.deps.emit({ type: "askClosed", flowId });
	}

	/** 回答一次提问：通过扩展的提交通道送回去，结果由 pi-ask 自己决定。 */
	private answerAsk(flowId: string, answers: Record<string, AskAnswer>, note?: string): void {
		if (this.pendingAsk?.flowId !== flowId) return;
		this.bus.emit(PI_ASK_SUBMIT, toSubmitPayload(flowId, answers, note));
	}

	private notify(level: "info" | "warning" | "error", message: string): void {
		this.deps.emit({ type: "toast", level, message });
	}
}

function usageOf(agent: AgentSession): UsageSummary {
	const stats = agent.getSessionStats();
	const context = agent.getContextUsage();
	return {
		input: stats.tokens.input,
		output: stats.tokens.output,
		cacheRead: stats.tokens.cacheRead,
		cacheWrite: stats.tokens.cacheWrite,
		total: stats.tokens.total,
		cost: stats.cost,
		contextUsed: context?.tokens ?? 0,
		contextWindow: context?.contextWindow ?? null,
	};
}

function toImageContent(image: PromptImage): ImageContent {
	return { type: "image", data: image.data, mimeType: image.mimeType };
}

function compareSessions(a: SessionSummary, b: SessionSummary): number {
	if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
	return b.updatedAt - a.updatedAt;
}

function upsertSummary(list: readonly SessionSummary[], summary: SessionSummary): SessionSummary[] {
	const rest = list.filter((session) => session.id !== summary.id);
	return [summary, ...rest].sort(compareSessions);
}

function titleOf(messages: readonly { role: string }[]): string {
	const firstUser = messages.find((message) => message.role === "user");
	if (!firstUser) return "";
	const text = textOf(firstUser);
	return previewLine(text);
}

function textOf(message: { role: string }): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (typeof block !== "object" || block === null) return "";
			const record = block as { type?: unknown; text?: unknown };
			return record.type === "text" && typeof record.text === "string" ? record.text : "";
		})
		.join("");
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 模型选择列表：可用性来自凭据快照，列表本身一次构建、按需重发。 */
export function buildModelViews(agent: AgentSession | undefined): ModelView[] {
	if (!agent) return [];
	const runtime = agent.modelRuntime;
	const available = new Set(runtime.getAvailableSnapshot().map((model) => `${model.provider}/${model.id}`));
	// 凭据快照还没就绪时退回“当前模型所属 provider 可用”，否则选择器会把上千个未配置的模型全列出来。
	const activeProvider = agent.model?.provider ?? null;
	return runtime
		.getModels()
		.map((model) => ({
			key: `${model.provider}/${model.id}`,
			provider: model.provider,
			id: model.id,
			name: model.name,
			reasoning: model.reasoning,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			available:
				available.size === 0 ? model.provider === activeProvider : available.has(`${model.provider}/${model.id}`),
		}))
		.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}

export { toSessionSummary };
