// main 与 renderer 之间的全部数据形状与 IPC 通道。preload 只做透传，不做转换。

export type ThemeMode = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";
export type Density = "comfortable" | "compact";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "auto";
export type AgentStatus = "idle" | "running";
export type Platform = "darwin" | "win32" | "linux";

/** 用户可改的偏好；main 负责持久化，renderer 只发增量补丁。 */
export type DesktopSettings = {
	theme: ThemeMode;
	fontScale: number;
	density: Density;
	showThinking: boolean;
	showToolDetails: boolean;
	showUsage: boolean;
	sidebarWidth: number;
	sidebarCollapsed: boolean;
	recentProjects: string[];
	pinnedSessions: string[];
};

/** 会话在侧栏一行里需要的全部信息。 */
export type SessionSummary = {
	id: string;
	path: string | null;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	pinned: boolean;
	status: AgentStatus;
	model: string | null;
	/** 最近一条消息的单行摘要，列表悬停和搜索结果里用。 */
	preview: string;
};

export type ProjectSummary = {
	path: string;
	name: string;
	lastOpenedAt: number;
};

export type UsageSummary = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	cost: number;
	contextUsed: number;
	contextWindow: number | null;
};

export type TurnUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cost: number;
	durationMs: number | null;
};

/** 工具调用在界面上的两种粗粒度载荷：一行摘要和展开后的正文。 */
export type ToolCallView = {
	id: string;
	name: string;
	state: "pending" | "running" | "done" | "error";
	/** 一行摘要：`read src/main.ts`、`bash npm test`。 */
	summary: string;
	/** 展开后的参数与结果正文，按工具类型生成。 */
	argsText: string;
	resultText: string;
	diff: { path: string; before: string; after: string } | null;
	durationMs: number | null;
};

export type AssistantPart =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "tool"; call: ToolCallView };

export type TranscriptItem =
	| { kind: "user"; id: string; text: string; timestamp: number; imageCount: number }
	| {
			kind: "assistant";
			id: string;
			parts: AssistantPart[];
			timestamp: number;
			streaming: boolean;
			model: string | null;
			usage: TurnUsage | null;
			error: string | null;
	  }
	| { kind: "notice"; id: string; level: "info" | "warning" | "error"; text: string; timestamp: number };

export type AgentView = {
	model: string | null;
	modelName: string | null;
	thinkingLevel: ThinkingLevel;
	reasoning: boolean;
	status: AgentStatus;
	usage: UsageSummary | null;
};

export type ModelView = {
	key: string;
	provider: string;
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
	/** 当前 provider 是否已配置凭据。 */
	available: boolean;
};

export type DesktopState = {
	platform: Platform;
	theme: ResolvedTheme;
	cwd: string;
	recentProjects: ProjectSummary[];
	sessions: SessionSummary[];
	activeSessionId: string | null;
	transcript: TranscriptItem[];
	agent: AgentView;
	settings: DesktopSettings;
};

export type DesktopCommand =
	| { type: "refreshSessions" }
	| { type: "openProject" }
	| { type: "openRecentProject"; path: string }
	| { type: "newSession" }
	| { type: "openSession"; id: string }
	| { type: "prompt"; text: string; images?: PromptImage[] }
	| { type: "steer"; text: string }
	| { type: "abort" }
	| { type: "renameSession"; id: string; title: string }
	| { type: "deleteSession"; id: string }
	| { type: "pinSession"; id: string; pinned: boolean }
	| { type: "updateSettings"; patch: Partial<DesktopSettings> }
	| { type: "setModel"; model: string }
	| { type: "setThinkingLevel"; level: ThinkingLevel }
	| { type: "listModels" }
	/** 项目内文件搜索，给 composer 的 @ 引用补全用。 */
	| { type: "searchFiles"; requestId: number; query: string }
	| { type: "windowControl"; action: "minimize" | "maximize" | "close" }
	| { type: "openExternal"; url: string }
	| { type: "revealPath"; path: string };

export type PromptImage = { data: string; mimeType: string; name?: string };

export type MenuAction = "newSession" | "openProject" | "settings" | "search" | "toggleSidebar" | "closeSession";

export type DesktopEvent =
	/** 全量快照：初始化、切换会话、会话列表、设置或状态变化。 */
	| { type: "state"; state: DesktopState }
	/** 当前会话的结构性变化（消息开始/结束、工具开始/结束）。 */
	| { type: "transcript"; sessionId: string; items: TranscriptItem[] }
	/** 流式文本增量，main 已按帧合并。 */
	| {
			type: "delta";
			sessionId: string;
			itemId: string;
			partIndex: number;
			partType: "text" | "thinking";
			delta: string;
	  }
	/** 模型选择列表，按需重发，不跟每次状态快照走。 */
	| { type: "models"; models: ModelView[] }
	/** @ 引用补全的结果，requestId 对应发起的那次搜索。 */
	| { type: "files"; requestId: number; files: string[] }
	/** 原生菜单触发的动作，renderer 转成对应命令。 */
	| { type: "menu"; action: MenuAction }
	| { type: "window"; maximized: boolean }
	| { type: "toast"; level: "info" | "warning" | "error"; message: string };

export type DesktopBridge = {
	getState(): Promise<DesktopState>;
	send(command: DesktopCommand): Promise<void>;
	onEvent(listener: (event: DesktopEvent) => void): () => void;
};

export const IPC_GET_STATE = "pi-desktop:get-state";
export const IPC_COMMAND = "pi-desktop:command";
export const IPC_EVENT = "pi-desktop:event";
