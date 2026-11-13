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
import { formatAttachedFiles, splitAttachedFiles } from "../shared/attached-files.ts";
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
	PromptAttachment,
	ResolvedTheme,
	SessionSummary,
	ThinkingLevel,
	TranscriptItem,
	UsageSummary,
} from "../shared/contract.ts";
import { folderName, samePath } from "../shared/paths.ts";
import { flowIdOf, PI_ASK_COMPLETED, PI_ASK_STARTED, PI_ASK_SUBMIT, toAskRequest, toSubmitPayload } from "./ask.ts";
import { idleSteps, type RunSteps, stepActivity, thinkingSteps, toolEnded, toolStarted } from "./run-activity.ts";
import { deleteSessionFile, listSessionSummaries, renameSessionFile, sessionTimes } from "./session-files.ts";
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
	/** 会话所属的 workspace（项目目录）：切走的 workspace 仍然活在内存里，且列在自己的块里。 */
	cwd: string;
	agent: AgentSession;
	manager: SessionManager;
	status: AgentStatus;
	toolDurations: Map<string, number>;
	items: TranscriptItem[];
	transcriptDirty: boolean;
	/** 正在生成的那条 assistant 消息；提交前它不在 agent.messages 里，界面靠它先显示。 */
	partial: AgentMessage | null;
	/** 正在跑的工具和思考起点；当前这一步由它派生，换步骤时计时自然跟着重置。 */
	steps: RunSteps;
	unsubscribe: () => void;
};

/**
 * 会话中枢。一个会话从打开到应用退出一直活着：切走只改变 activeId，正在跑的任务继续跑，
 * 侧栏的忙碌状态也跟着各自的会话走。
 */
export class SessionHost {
	private readonly deps: HostDeps;
	/** 当前选中的 workspace；null 表示还没选，此时不能聊天。 */
	private cwd: string | null;
	/** 侧栏列出的 workspace（项目目录），顺序即加入顺序。 */
	private workspaces: string[];
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

	constructor(cwd: string | null, deps: HostDeps) {
		this.cwd = cwd;
		this.workspaces = deps.settings.get().workspaces;
		this.deps = deps;
		this.bus.on(PI_ASK_STARTED, (data) => this.onAskStarted(data));
		this.bus.on(PI_ASK_COMPLETED, (data) => this.onAskCompleted(data));
	}

	getWorkspace(): string | null {
		return this.cwd;
	}

	/** 当前渲染所需的全部数据；transcript 取的是活动会话的最新投影。 */
	buildState(): DesktopState {
		const settings = this.deps.settings.get();
		const active = this.activeSession();
		return {
			platform: this.deps.platform,
			theme: this.deps.theme(),
			workspace: this.cwd,
			workspaces: this.workspaces.map((path) => ({ path, name: folderName(path) })),
			sessions: this.summaries,
			activeSessionId: this.activeId,
			transcript: active ? this.transcriptOf(active) : [],
			agent: this.agentView(active),
			settings,
		};
	}

	/** 首次装载：读出 workspace 列表，选中上次那一个，并把它最近的会话打开。 */
	async start(): Promise<void> {
		const settings = this.deps.settings.get();
		this.workspaces = settings.workspaces;
		// 开发时用 PI_DESKTOP_CWD 直接指定；否则回到上次选中的 workspace。
		const requested = this.cwd ?? settings.activeWorkspace;
		if (requested !== null) this.focusWorkspace(requested);
		await this.refreshSessions();
		const recent = this.cwd === null ? undefined : this.newestIn(this.cwd);
		if (recent?.path) await this.openById(recent.id);
		this.flushNow();
	}

	async handle(command: DesktopCommand): Promise<void> {
		switch (command.type) {
			case "refreshSessions":
				await this.refreshSessions();
				return this.flushNow();
			case "addWorkspace": {
				const directory = await this.deps.pickDirectory();
				if (directory) await this.selectWorkspace(directory);
				return;
			}
			case "selectWorkspace":
				await this.selectWorkspace(command.path);
				return;
			case "newSession":
				await this.createSession();
				return this.flushNow();
			case "openSession":
				await this.openById(command.id);
				return this.flushNow();
			case "prompt":
				await this.prompt(command.text, command.attachments ?? []);
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

	/** 选中一个 workspace：登记进列表、设为当前，再把它的会话列出来。 */
	private async selectWorkspace(path: string): Promise<void> {
		this.registerWorkspace(path);
		// 点已经在用的那一行不重置当前会话，只刷新列表。
		if (this.cwd !== null && samePath(this.cwd, path, this.deps.platform)) return this.flushNow();
		this.cwd = path;
		this.activeId = null;
		this.deps.settings.setActiveWorkspace(path);
		await this.refreshSessions();
		const recent = this.newestIn(path);
		if (recent?.path) await this.openById(recent.id);
		this.flushNow();
	}

	/** 目录进 workspace 列表（去重），并带回最新的列表。 */
	private registerWorkspace(path: string): void {
		const settings = this.deps.settings;
		if (!settings.get().workspaces.some((entry) => samePath(entry, path, this.deps.platform))) {
			settings.addWorkspace(path);
		}
		this.workspaces = settings.get().workspaces;
	}

	/** 把某个目录设为当前 workspace；只改选中项，不换会话。 */
	private focusWorkspace(path: string): void {
		this.registerWorkspace(path);
		if (this.cwd !== null && samePath(this.cwd, path, this.deps.platform)) return;
		this.cwd = path;
		this.deps.settings.setActiveWorkspace(path);
	}

	/** 某个 workspace 最近活动的那条落盘会话；没有就 undefined。 */
	private newestIn(workspace: string): SessionSummary | undefined {
		return this.summaries.find(
			(session) => session.path !== null && samePath(session.workspace, workspace, this.deps.platform),
		);
	}

	private activeSession(): LiveSession | undefined {
		return this.activeId ? this.live.get(this.activeId) : undefined;
	}

	/** 新建会话；没有选中 workspace 时只提示不动手——聊天必须先选 workspace。 */
	private async createSession(): Promise<LiveSession | null> {
		const workspace = this.cwd;
		if (workspace === null) {
			this.notify("info", "Select a workspace first.");
			return null;
		}
		const live = await this.createLive(SessionManager.create(workspace), workspace);
		this.activeId = live.id;
		this.summaries = upsertSummary(this.summaries, this.summaryOf(live));
		this.markState();
		return live;
	}

	/** 按 id 打开；已活着的会话直接切换，不重新加载磁盘。 */
	private async openById(id: string, path?: string): Promise<void> {
		const existing = this.live.get(id);
		if (existing) {
			this.focusWorkspace(existing.cwd);
			this.activeId = existing.id;
			existing.transcriptDirty = true;
			this.markStructure();
			this.markState();
			return;
		}
		const summary = this.summaries.find((session) => session.id === id);
		const target = path ?? summary?.path;
		if (!target) return;
		const workspace = summary?.workspace ?? this.cwd;
		if (workspace === null) return;
		// 打开别的 workspace 里的会话，顺手把那个 workspace 设为当前：后续提问落在正确的项目里。
		this.focusWorkspace(workspace);
		const live = await this.createLive(SessionManager.open(target), workspace);
		this.activeId = live.id;
		this.markStructure();
		this.markState();
	}

	private async createLive(manager: SessionManager, workspace: string): Promise<LiveSession> {
		// 总线由宿主创建并交给扩展：pi-ask 的 started/submit 两个方向都落在同一个通道上。
		const services = await createAgentSessionServices({
			cwd: workspace,
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
			cwd: manager.getCwd(),
			agent: session,
			manager,
			status: "idle",
			toolDurations: new Map(),
			items: [],
			transcriptDirty: true,
			partial: null,
			steps: idleSteps,
			unsubscribe: () => {},
		};
		live.unsubscribe = session.subscribe((event) => this.onSessionEvent(live, event));
		this.live.set(live.id, live);
		return live;
	}

	private async prompt(text: string, attachments: readonly PromptAttachment[]): Promise<void> {
		const images = attachments.filter((item) => item.kind === "image");
		// 普通文件只把路径告诉模型：agent 自己有读文件的手，整份正文不必塞进上下文
		const files = attachments.flatMap((item) => (item.kind === "file" ? [item.path] : []));
		const trimmed = [text.trim(), formatAttachedFiles(files)].filter(Boolean).join("\n\n");
		if (!trimmed) return;
		const live = this.activeSession() ?? (await this.createSession());
		if (!live) return;
		const payload = images.map(toImageContent);
		try {
			if (live.agent.isStreaming) {
				await live.agent.steer(trimmed, payload);
			} else {
				live.status = "running";
				// 预填期也算在思考：状态行从点发送那一帧起就要有话说。
				live.steps = thinkingSteps(Date.now());
				this.markState();
				void live.agent
					.prompt(trimmed, {
						images: payload,
						// 扩展命令或 input handler 吃掉了这次输入时，不会有任何 run 事件回来：
						// 不在这里收回状态，界面会一直停在“Thinking for 12m”。
						preflightResult: (disposition) => {
							if (disposition !== "handled") return;
							// 扩展 handler 常会自己起一轮（command context 的 sendUserMessage 是 fire-and-forget），
							// 而这个回调在 handler 返回之后才发出：此时 run 已经在跑，不能把它打回空闲。
							// 真起跑的那一轮由 agent_start 负责把状态拉回来。
							if (live.agent.isStreaming) return;
							live.status = "idle";
							live.steps = idleSteps;
							this.markState();
						},
					})
					// prompt 会等到整轮结束；不阻塞 IPC 返回，错误交给下面统一上报。
					.catch((error: unknown) => this.report(live, error));
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

	/** 每个 workspace 的磁盘会话 + 内存里还没落盘的会话，按最近修改排序。 */
	private async refreshSessions(): Promise<void> {
		const pinned = new Set(this.deps.settings.get().pinnedSessions);
		const listed = await Promise.all(
			this.workspaces.map(async (workspace) => {
				try {
					return await listSessionSummaries(workspace, pinned);
				} catch (error) {
					this.notify("error", `Failed to list sessions in ${workspace}: ${messageOf(error)}`);
					return [];
				}
			}),
		);
		const merged = new Map(listed.flat().map((session) => [session.id, session]));
		for (const live of this.live.values()) {
			// 活会话列在它自己的 workspace 下；不在列表里的目录不出现。
			if (!this.workspaces.some((workspace) => samePath(workspace, live.cwd, this.deps.platform))) continue;
			merged.set(live.id, this.summaryOf(live, merged.get(live.id)));
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
		const times = sessionTimes(messages, Date.now());
		return {
			id: live.id,
			path: live.agent.sessionFile ?? null,
			workspace: live.cwd,
			title: live.manager.getSessionName()?.trim() || titleOf(messages) || UNTITLED,
			createdAt: times.createdAt,
			updatedAt: times.updatedAt,
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
			activity: live ? stepActivity(live.steps) : null,
			usage: live ? usageOf(live.agent) : null,
		};
	}

	private onSessionEvent(live: LiveSession, event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				// 只有这个事件能证明真的起跑了：扩展命令自己发起的 run、自动重试的新一轮、压缩后继续，
				// 都不经过本类的 prompt()。思考计时也从这里起算，重试那几轮不会跨尝试累加。
				live.status = "running";
				live.steps = thinkingSteps(Date.now());
				this.markState();
				this.scheduleTranscriptFlush();
				return;
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
				live.steps = toolStarted(live.steps, event.toolCallId, event.toolName, Date.now());
				this.markState();
				this.markStructure();
				this.scheduleTranscriptFlush();
				return;
			case "tool_execution_update":
				this.markStructure();
				this.scheduleTranscriptFlush();
				return;
			case "tool_execution_end": {
				const startedAt = live.steps.tools.get(event.toolCallId)?.startedAt;
				if (startedAt !== undefined) live.toolDurations.set(event.toolCallId, Date.now() - startedAt);
				live.steps = toolEnded(live.steps, event.toolCallId, Date.now());
				// 无条件标脏：并行批次里结束的是哪一件工具，会让显示的那一步换成别的工具或换成思考。
				this.markState();
				this.markStructure();
				this.scheduleTranscriptFlush();
				return;
			}
			case "agent_end":
				if (!live.agent.isStreaming) live.status = "idle";
				live.partial = null;
				// 这里不清步骤：一轮可能还在继续（自动重试、压缩后继续、排队的消息都会再起一次 run，
				// 见 coding-agent 的 _handlePostAgentRun），只有 agent_settled 才代表真的结束。
				this.markStructure();
				this.markState();
				this.flushNow();
				return;
			case "agent_settled":
				live.status = "idle";
				live.partial = null;
				live.steps = idleSteps;
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
		if (!live.agent.isStreaming) live.steps = idleSteps;
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

function toImageContent(image: Extract<PromptAttachment, { kind: "image" }>): ImageContent {
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
	const text = splitAttachedFiles(textOf(firstUser)).text;
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
