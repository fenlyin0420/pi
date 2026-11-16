// main 进程的会话中枢：打开过的会话各自保留一个活 AgentSession，事件在这里合并后推给 renderer。

import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	createEventBus,
	getAgentDir,
	ModelRuntime,
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
	ImageView,
	IssueRunView,
	IssueSummary,
	ModelView,
	Platform,
	PromptAttachment,
	QueuedMessages,
	ResolvedTheme,
	SessionSummary,
	ThinkingLevel,
	TranscriptItem,
	UsageSummary,
} from "../shared/contract.ts";
import { folderName, samePath } from "../shared/paths.ts";
import { artifactKey, clearArtifacts, putArtifact } from "./artifacts.ts";
import {
	flowIdOf,
	PI_ASK_COMPLETED,
	PI_ASK_STARTED,
	PI_ASK_SUBMIT,
	toAskRequest,
	toCancelPayload,
	toSubmitPayload,
} from "./ask.ts";
import { createImmersiveExtension } from "./immersive.ts";
import { imageViewOf } from "./message-images.ts";
import { idleSteps, type RunSteps, stepActivity, thinkingSteps, toolEnded, toolStarted } from "./run-activity.ts";
import { deleteSessionFile, listSessionSummaries, renameSessionFile, sessionTimes } from "./session-files.ts";
import type { SettingsStore } from "./settings.ts";
import { latestTodoTasks } from "./todo-call.ts";
import { itemIdAt, previewLine, toTranscriptItems } from "./transcript.ts";

/** 结构变化和流式增量的合并窗口：一帧一次 IPC，token 不再逐条过网。 */
const TRANSCRIPT_FLUSH_MS = 32;
/** 快照合并窗口；会话列表和状态变化不需要每事件一份。 */
const STATE_FLUSH_MS = 48;
const UNTITLED = "New session";
/** 没有活动会话时的空队列：常量复用，免得每帧造新对象打穿 renderer 的 memo。 */
const EMPTY_QUEUE: QueuedMessages = { steering: [], followUp: [] };
/** 没有 issues 服务时的队列视图：常量复用，免得每帧造新对象。 */
const EMPTY_RUN: IssueRunView = { running: [], pending: 0, paused: false };

export type HostDeps = {
	settings: SettingsStore;
	platform: Platform;
	theme(): ResolvedTheme;
	emit(event: DesktopEvent): void;
	/** 目录选择由 index 实现，返回 null 表示用户取消。 */
	pickDirectory(): Promise<string | null>;
	/** issues 的列表与队列：数据在 IssuesService 里，快照只负责带上。 */
	issues?: { summaries(): IssueSummary[]; runView(): IssueRunView };
	/** issue 线程会话的专属工具；普通会话一个都不挂。 */
	issueTools?: { forSession(sessionId: string): ToolDefinition[]; forIssue(issueId: string): ToolDefinition[] };
	/** 会话被删掉：issue 那边要放开线程引用，下次运行重建。 */
	sessionRemoved?(sessionId: string): void;
};

/** 扩展与宿主共用的那种事件总线；每个会话一条，提问和答案都落在发起它的那条上。 */
type EventBus = ReturnType<typeof createEventBus>;

/** 一份还没答完的提问：属于哪个会话，答案该从哪条总线送回去。 */
type PendingAsk = { sessionId: string; bus: EventBus; request: AskRequest };

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
	/** 已提交、还没送达模型的消息，来自 queue_update；界面靠它显形。 */
	queued: { steering: string[]; followUp: string[] };
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
	/** 后台跑出新内容、用户还没切回去看过的会话；切过去就清掉。 */
	private readonly unread = new Set<string>();
	private summaries: SessionSummary[] = [];
	private activeId: string | null = null;
	private transcriptTimer: NodeJS.Timeout | null = null;
	private stateTimer: NodeJS.Timeout | null = null;
	private structureDirty = false;
	private stateDirty = false;
	/** 还没答完的提问，按 flowId 存：多个会话可以各挂一份，互不覆盖。 */
	private readonly pendingAsks = new Map<string, PendingAsk>();
	/** 全应用共用一份模型目录（和 TUI 一样）：选择器的清单和可用性都从它出。 */
	private runtime: ModelRuntime | null = null;
	/** 开着沉浸模式的会话；`before_agent_start` 每轮读一次，改它就从下一轮生效。 */
	private readonly immersive: Set<string>;

	constructor(cwd: string | null, deps: HostDeps) {
		this.cwd = cwd;
		this.workspaces = deps.settings.get().workspaces;
		this.deps = deps;
		this.immersive = new Set(deps.settings.get().immersiveSessions);
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
			todos: active ? latestTodoTasks(active.agent.messages) : [],
			agent: this.agentView(active),
			settings,
			issues: this.deps.issues?.summaries() ?? [],
			issueRun: this.deps.issues?.runView() ?? EMPTY_RUN,
		};
	}

	/** 首次装载：读出 workspace 列表，选中上次那一个；会话只由用户打开或新建，启动时开一个空会话。 */
	async start(): Promise<void> {
		const settings = this.deps.settings.get();
		this.workspaces = settings.workspaces;
		// 开发时用 PI_DESKTOP_CWD 直接指定；否则回到上次选中的 workspace。
		const requested = this.cwd ?? settings.activeWorkspace;
		if (requested !== null) this.focusWorkspace(requested);
		await this.refreshSessions();
		this.runtime = await this.createModelRuntime();
		// 和 TUI 一样：应用一起来就有一个会话（不落盘），工具栏的模型、思考等级、用量都有落点。
		if (this.cwd !== null && this.activeSession() === undefined) await this.createSession();
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
				await this.createSession(command.workspace);
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
			case "withdrawQueue":
				this.withdrawQueue();
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
			case "setImmersive":
				this.setImmersive(command.sessionId ?? this.activeId, command.immersive);
				return;
			case "updateSettings":
				this.updateSettings(command.patch);
				return;
			case "askAnswer":
				this.answerAsk(command.flowId, command.answers, command.note);
				return;
			case "askCancel":
				this.cancelAsk(command.flowId);
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

	/**
	 * 模型目录：整个应用一份（和 TUI 一样），会话也用它。
	 * 它不需要 cwd，所以应用一起来就有清单，选择器不必等到有会话。
	 */
	private async createModelRuntime(): Promise<ModelRuntime | null> {
		const agentDir = getAgentDir();
		try {
			return await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: join(agentDir, "models.json"),
			});
		} catch (error) {
			this.notify("error", messageOf(error));
			return null;
		}
	}

	/** 模型列表：模型选择器打开时取一次，凭据变化后重取。 */
	listModels(): void {
		const runtime = this.runtime;
		if (!runtime) return;
		const provider = this.activeSession()?.agent.model?.provider ?? null;
		this.deps.emit({ type: "models", models: buildModelViews(runtime, provider) });
	}

	/** 用户消息里的第 index 张图片，答内置查看器：粘贴进来的图没有磁盘路径，只能从消息块里取。 */
	messageImage(sessionId: string, messageIndex: number, imageIndex: number): ImageView | null {
		const message = this.live.get(sessionId)?.agent.messages[messageIndex];
		return message ? imageViewOf(message, imageIndex) : null;
	}

	/**
	 * 选中一个 workspace：登记进列表、设为当前，刷新它的会话列表。
	 * 已经打开的会话不动：换 workspace 只换“新会话开在哪、列表展开谁”，不换正在看的那一页。
	 */
	private async selectWorkspace(path: string): Promise<void> {
		this.registerWorkspace(path);
		// 点已经在用的那一行只刷新列表。
		if (this.cwd !== null && samePath(this.cwd, path, this.deps.platform)) return this.flushNow();
		this.cwd = path;
		this.deps.settings.setActiveWorkspace(path);
		await this.refreshSessions();
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

	private activeSession(): LiveSession | undefined {
		return this.activeId ? this.live.get(this.activeId) : undefined;
	}

	/** 新建会话；显式给了 workspace 就先切到它（右键某个文件夹新建），否则用当前 workspace。 */
	private async createSession(workspace = this.cwd): Promise<LiveSession | null> {
		if (workspace === null) {
			this.notify("info", "Select a workspace first.");
			return null;
		}
		// 新会话开在哪个目录，哪个目录就是当前 workspace：侧栏它自己展开，composer 底部也换成它。
		this.focusWorkspace(workspace);
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
			this.markRead(existing.id);
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
		const live = await this.createLive(SessionManager.open(target), workspace, {
			customTools: this.deps.issueTools?.forSession(id) ?? [],
		});
		this.activeId = live.id;
		this.markRead(live.id);
		this.markStructure();
		this.markState();
	}

	private async createLive(
		manager: SessionManager,
		workspace: string,
		extra?: { customTools?: ToolDefinition[] },
	): Promise<LiveSession> {
		// 每个会话一条自己的总线：pi-ask 的提问和答案都落在发起它的那条上。
		// 共用一条就分不出哪个会话在问，后一个问题会把前一个盖掉。
		const bus = createEventBus();
		// 内联扩展在建会话时就装好，而它读取的会话 id 此时还没有：工厂闭包读这个壳，
		// 真正调用发生在新一轮开始时（那时 id 已经填好）。
		const identity: { sessionId: string | null } = { sessionId: null };
		const services = await createAgentSessionServices({
			cwd: workspace,
			resourceLoaderOptions: {
				eventBus: bus,
				extensionFactories: [
					createImmersiveExtension(() => identity.sessionId !== null && this.immersive.has(identity.sessionId)),
				],
			},
			// 唯一的模型目录：选择器列的和会话用的必需是同一份，可用性才不会两边不一致。
			modelRuntime: this.runtime ?? undefined,
		});
		const { session, modelFallbackMessage } = await createAgentSessionFromServices({
			services,
			sessionManager: manager,
			customTools: extra?.customTools ?? [],
		});
		// 对扩展而言我们是“没有终端、但有传输”的宿主：pi-ask 据此走事件契约而不是 TUI 组件。
		await session.bindExtensions({ mode: "rpc" });
		const sessionId = session.sessionId;
		identity.sessionId = sessionId;
		bus.on(PI_ASK_STARTED, (data) => this.onAskStarted(sessionId, bus, data));
		bus.on(PI_ASK_COMPLETED, (data) => this.onAskCompleted(sessionId, data));
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
			queued: { steering: [], followUp: [] },
			unsubscribe: () => {},
		};
		live.unsubscribe = session.subscribe((event) => this.onSessionEvent(live, event));
		this.live.set(live.id, live);
		return live;
	}

	/** 外部状态（如 issue 列表）变了：推一帧快照。 */
	touch(): void {
		this.markState();
	}

	/**
	 * 给一条 issue 拿到它的线程会话，不抢当前视图：后台任务不该换掉用户正在看的会话。
	 * 会话被删过的话（没在最远列表里）重建一条，引用由调用方写回 issue。
	 */
	async ensureIssueSession(issue: {
		id: string;
		number: number;
		title: string;
		workspace: string;
		sessionId: string | null;
	}): Promise<string> {
		if (issue.sessionId) {
			const open = this.live.get(issue.sessionId);
			if (open) return open.id;
			const path = this.summaries.find((session) => session.id === issue.sessionId)?.path;
			if (path) {
				const reopened = await this.createLive(SessionManager.open(path), issue.workspace, {
					customTools: this.deps.issueTools?.forSession(issue.sessionId) ?? [],
				});
				this.summaries = upsertSummary(this.summaries, this.summaryOf(reopened));
				this.markState();
				return reopened.id;
			}
		}
		const live = await this.createLive(SessionManager.create(issue.workspace), issue.workspace, {
			customTools: this.deps.issueTools?.forIssue(issue.id) ?? [],
		});
		// 侧栏标题直接用编号和标题：从会话里猜出来的第一行不如这两样准。
		live.manager.appendSessionInfo(`#${issue.number} ${issue.title}`);
		this.summaries = upsertSummary(this.summaries, this.summaryOf(live));
		this.markState();
		return live.id;
	}

	/** 向指定会话发一轮提示；不要求它是当前会话。 */
	async promptSession(sessionId: string, text: string): Promise<void> {
		const live = this.live.get(sessionId);
		if (!live) throw new Error("Session is not open");
		live.status = "running";
		live.steps = thinkingSteps(Date.now());
		this.markStructureOf(live);
		this.markState();
		this.scheduleTranscriptFlush();
		await live.agent.prompt(text);
	}

	async abortSession(sessionId: string): Promise<void> {
		const live = this.live.get(sessionId);
		if (!live) return;
		await live.agent.abort();
		this.markState();
	}

	/** 切到某条会话（issue 的 Open thread）：没开着就按磁盘打开。 */
	async openSession(id: string): Promise<void> {
		await this.openById(id);
		this.flushNow();
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

	/**
	 * 撤回所有排队消息。clearQueue 只能整批清，所以界面上的按钮也是“撤回全部”；
	 * 清完之后的队列变化会再发一次 queue_update，待送达的气泡随之消失。
	 */
	private withdrawQueue(): void {
		const live = this.activeSession();
		if (!live) return;
		const { steering, followUp } = live.agent.clearQueue();
		const text = [...steering, ...followUp].join("\n\n");
		if (text) this.deps.emit({ type: "draftRestore", sessionId: live.id, text });
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
		// 会话没了，它名下的提问也跟着失效：界面上那张卡得同时收起，否则再也没人能答它。
		for (const [flowId, pending] of this.pendingAsks) {
			if (pending.sessionId !== id) continue;
			this.pendingAsks.delete(flowId);
			this.deps.emit({ type: "askClosed", sessionId: id, flowId });
		}
		this.unread.delete(id);
		clearArtifacts(id);
		this.deps.sessionRemoved?.(id);
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
		if (this.immersive.delete(id)) this.deps.settings.update({ immersiveSessions: [...this.immersive] });
		await this.refreshSessions();
		this.flushNow();
	}

	/** 开关某个会话的沉浸模式：内存标志（下一轮生效）和设置一起写。 */
	private setImmersive(id: string | null, immersive: boolean): void {
		if (id === null) return;
		if (immersive) this.immersive.add(id);
		else this.immersive.delete(id);
		this.deps.settings.update({ immersiveSessions: [...this.immersive] });
		this.markState();
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
		// 设置里也能整批改沉浸会话（设置文件、将来别的入口）：内存标志跟着磁盘走，别分叉。
		if (patch.immersiveSessions !== undefined) {
			this.immersive.clear();
			for (const id of this.deps.settings.get().immersiveSessions) this.immersive.add(id);
		}
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

	/** 后台会话落地一条助手消息：记成未读，侧栏那一行画圆点。切到它就由 markRead 清掉。 */
	private markUnread(id: string): void {
		if (id === this.activeId || this.unread.has(id)) return;
		this.unread.add(id);
		this.summaries = this.summaries.map((session) => (session.id === id ? { ...session, unread: true } : session));
		this.markState();
	}

	/** 用户正在看的会话不算未读：切过去、新建或它自己落地消息都走这里。 */
	private markRead(id: string): void {
		if (!this.unread.delete(id)) return;
		this.summaries = this.summaries.map((session) => (session.id === id ? { ...session, unread: false } : session));
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
		// 会话列表重建会把内存里的标记拿掉：磁盘那一份不知道谁在等人回答，活会话重新算一遍。
		this.summaries = [...merged.values()]
			.sort(compareSessions)
			.map((session) => (this.hasPendingAsk(session.id) ? { ...session, awaitingAsk: true } : session));
		this.markState();
	}

	private summaryOf(live: LiveSession, base?: SessionSummary): SessionSummary {
		const model = live.agent.model;
		if (base) {
			return {
				...base,
				status: live.status,
				unread: this.unread.has(live.id),
				awaitingAsk: this.hasPendingAsk(live.id),
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
			unread: this.unread.has(live.id),
			awaitingAsk: this.hasPendingAsk(live.id),
			model: model ? `${model.provider}/${model.id}` : null,
			preview: previewLine(lastText),
		};
	}

	private transcriptOf(live: LiveSession): TranscriptItem[] {
		if (live.transcriptDirty) {
			live.items = toTranscriptItems(live.agent.messages, {
				streamingIndex: null,
				toolDurations: live.toolDurations,
				runningToolIds: live.steps.tools,
			});
			this.cacheArtifacts(live.id, live.items);
			live.transcriptDirty = false;
		}
		if (!live.partial) return live.items;
		// 未提交的那条消息单独投影：id 用它将来的下标，落地成正式消息时界面不会重挂。
		const [streaming] = toTranscriptItems([live.partial], {
			streamingIndex: 0,
			toolDurations: live.toolDurations,
			runningToolIds: live.steps.tools,
		});
		if (!streaming) return live.items;
		const items = [...live.items, { ...streaming, id: itemIdAt(live.agent.messages.length) }];
		this.cacheArtifacts(live.id, items);
		return items;
	}

	/**
	 * 把这一份投影里的产物写进协议的投递层。真身始终在消息里：这里只是让 iframe 取得到正文，
	 * 重开会话时由同一条投影路径重新写满。
	 */
	private cacheArtifacts(sessionId: string, items: readonly TranscriptItem[]): void {
		// 每次投影整份替换：压缩后消息下标前移，旧 key 不会再被命中，留着只会漏内存。
		clearArtifacts(sessionId);
		for (const item of items) {
			if (item.kind !== "assistant") continue;
			for (const part of item.parts) {
				if (part.type !== "artifact") continue;
				putArtifact(artifactKey(sessionId, part.artifact.id), part.artifact.html);
			}
		}
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
			queued: live?.queued ?? EMPTY_QUEUE,
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
				// 消息落地（或被丢弃）：收起流式快照，让已提交的消息自己占位。
				live.partial = null;
				this.markStructure();
				this.scheduleTranscriptFlush();
				if (event.type === "message_end") {
					// 用户不在这个会话里，回答写在后台：侧栏给它记一个未读圆点。
					if (event.message.role === "assistant") this.markUnread(live.id);
					void this.refreshSessionsQuietly();
				}
				return;
			case "queue_update":
				// 队列变化不改记录，只改“还没送达”的那一层：两个数组原样存下来，界面自己投影。
				live.queued = { steering: [...event.steering], followUp: [...event.followUp] };
				this.markState();
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

	/** 只标某条会话自身：后台会话脏了不弄脏当前会话的快照。 */
	private markStructureOf(live: LiveSession): void {
		live.transcriptDirty = true;
		if (live.id !== this.activeId) return;
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

	/** pi-ask 开始提问：转成界面契约推给 renderer，按 flowId 存好，答案和取消都靠它找回总线。 */
	private onAskStarted(sessionId: string, bus: EventBus, data: unknown): void {
		const request = toAskRequest(data);
		if (!request) return;
		this.pendingAsks.set(request.flowId, { sessionId, bus, request });
		this.setAwaiting(sessionId, true);
		this.deps.emit({ type: "ask", sessionId, request });
	}

	/** 提问结束（提交、取消或超时）：让界面上那张卡自己收起，会话行上的问号点一并去掉。 */
	private onAskCompleted(sessionId: string, data: unknown): void {
		const flowId = flowIdOf(data);
		if (!flowId) return;
		this.pendingAsks.delete(flowId);
		this.setAwaiting(sessionId, this.hasPendingAsk(sessionId));
		this.deps.emit({ type: "askClosed", sessionId, flowId });
	}

	/** 回答一次提问：通过发起它的那条总线送回去，结果由 pi-ask 自己决定。 */
	private answerAsk(flowId: string, answers: Record<string, AskAnswer>, note?: string): void {
		const pending = this.pendingAsks.get(flowId);
		if (!pending) return;
		pending.bus.emit(PI_ASK_SUBMIT, toSubmitPayload(flowId, answers, note));
	}

	/** 关掉一次提问而不作答：pi-ask 把这一轮当用户取消，不必等到十分钟超时才知道。 */
	private cancelAsk(flowId: string): void {
		const pending = this.pendingAsks.get(flowId);
		if (!pending) return;
		pending.bus.emit(PI_ASK_SUBMIT, toCancelPayload(flowId));
	}

	private hasPendingAsk(sessionId: string): boolean {
		for (const pending of this.pendingAsks.values()) {
			if (pending.sessionId === sessionId) return true;
		}
		return false;
	}

	/** 侧栏那一行要不要标“在等你回答”；提问开始、结束和重建会话列表都走同一个判断。 */
	private setAwaiting(sessionId: string, awaiting: boolean): void {
		if (!this.summaries.some((session) => session.id === sessionId && session.awaitingAsk !== awaiting)) return;
		this.summaries = this.summaries.map((session) =>
			session.id === sessionId ? { ...session, awaitingAsk: awaiting } : session,
		);
		this.markState();
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

/**
 * 模型选择列表：可用性来自凭据快照，列表本身一次构建、按需重发。
 * activeProvider 是当前会话的 provider，用它把“谁都没凭据”的空档限定在一个 provider 上。
 */
export function buildModelViews(runtime: ModelRuntime, activeProvider: string | null): ModelView[] {
	const available = new Set(runtime.getAvailableSnapshot().map((model) => `${model.provider}/${model.id}`));
	// 凭据快照还没就绪时退回“当前模型所属 provider 可用”，否则选择器会把上千个未配置的模型全列出来。
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
