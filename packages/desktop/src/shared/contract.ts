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
	/** 右侧 diff 面板宽度；面板没打开时也记着，下次打开用同一个宽度。 */
	diffPanelWidth: number;
	/** 侧栏里列出的 workspace（项目目录），按加入顺序。 */
	workspaces: string[];
	/** 当前选中的 workspace；null 表示还没选，此时不能聊天。 */
	activeWorkspace: string | null;
	pinnedSessions: string[];
	/** 开着沉浸模式的会话：主栏由 HTML 舞台替代对话区。 */
	immersiveSessions: string[];
	/** 队列同时跑几条 issue（1–5）。并行会在同一个项目里开多个会话，改文件可能互覆。 */
	issuesConcurrency: number;
};

/** 会话在侧栏一行里需要的全部信息。 */
export type SessionSummary = {
	id: string;
	path: string | null;
	/** 会话属于哪个 workspace（项目目录）；侧栏按它分块。 */
	workspace: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messageCount: number;
	pinned: boolean;
	status: AgentStatus;
	/** 切走之后它又跑出了新内容：侧栏行上画一个圆点，切回去看过就清掉。 */
	unread: boolean;
	/** 这个会话有一次 ask_user 还在等回答：侧栏行上换成问号点，与“跑出了新内容”分开。 */
	awaitingAsk: boolean;
	model: string | null;
	/** 最近一条消息的单行摘要，列表悬停和搜索结果里用。 */
	preview: string;
};

/** 侧栏里的一个 workspace：一个项目目录，名字取末段目录名。 */
export type WorkspaceSummary = {
	path: string;
	name: string;
};

/**
 * 实验性 issues 的一条工作项。用户在动作区建 issue，agent 在自己的线程会话里解决它；
 * 关闭只有人能点，模型跑完只到 review。
 */
export type IssueStatus = "open" | "queued" | "running" | "review" | "closed";

/** 列表里的 issue：正文和评论按需再取，快照里只带这些。 */
export type IssueSummary = {
	id: string;
	/** 按 workspace 自增，界面上写作 #12。 */
	number: number;
	workspace: string;
	title: string;
	status: IssueStatus;
	createdAt: number;
	updatedAt: number;
	/** 线程会话；第一次运行时才创建。 */
	sessionId: string | null;
	/** agent 报的卡住原因；只有 open 状态带这个。 */
	blocked: string | null;
	/** 上一次运行失败或被打断的原因。 */
	error: string | null;
};

/** issue 下面的一条记录：用户补充、agent 的进度，或交卷摘要。 */
export type IssueComment = { at: number; author: "user" | "agent"; text: string };

/** 选中一条 issue 时取的完整内容。 */
export type IssueDetail = IssueSummary & { body: string; comments: IssueComment[] };

/** 队列现在的样子：在跑哪几条、还剩几条、是否暂停。 */
export type IssueRunView = { running: string[]; pending: number; paused: boolean };

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

/** 一次改文件调用的前后文本：行内 diff、整轮的已编辑文件卡片和右栏面板共用。 */
export type ToolDiffView = {
	path: string;
	before: string;
	after: string;
	/** 原文或新文超过 diff 上限：只保留了开头那一段。 */
	truncated: boolean;
};

/** pi-todo 的任务状态；deleted 是墓碑，只在历史里留着，清单上不显示。 */
export type TodoStatus = "pending" | "in_progress" | "completed" | "deleted";

/** 快照里的一条任务。 */
export type TodoTaskView = {
	id: number;
	subject: string;
	status: TodoStatus;
	/** in_progress 时给读者的进行时标签（`writing tests`）；没有就是 null。 */
	activeForm: string | null;
	/** 还在等的任务 id。 */
	blockedBy: readonly number[];
};

/**
 * 一次 todo 工具调用之后的任务快照。`tasks` 是那次调用的完整结果，所以最后一张卡片
 * 就是这个会话现在的清单；`error` 是被拒绝那次调用给出的原因。
 */
export type TodoCallView = {
	tasks: readonly TodoTaskView[];
	error: string | null;
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
	/** 改文件类工具的原文/新文；truncated 表示任一侧被 diff 上限截过。 */
	diff: ToolDiffView | null;
	/** todo 工具的任务快照；别的工具、以及没有快照的调用都是 null，卡片按普通工具画。 */
	todo: TodoCallView | null;
	durationMs: number | null;
};

/** 一份渲染出来的 HTML 产物：工具产出，或从正文围栏块兜底提取。 */
export type ArtifactView = {
	id: string;
	title: string;
	html: string;
	source: "tool" | "fence";
};

export type AssistantPart =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "tool"; call: ToolCallView }
	| { type: "artifact"; artifact: ArtifactView };

export type TranscriptItem =
	| {
			kind: "user";
			id: string;
			text: string;
			timestamp: number;
			imageCount: number;
			/** 这一轮带上的文件路径；正文里的附件块在映射时已经剥掉。 */
			files: string[];
			/** 这条消息在会话里的下标；内置查看器按它取图片块。 */
			messageIndex: number;
	  }
	| {
			kind: "assistant";
			id: string;
			parts: AssistantPart[];
			timestamp: number;
			streaming: boolean;
			model: string | null;
			usage: TurnUsage | null;
			/** 用户打断收尾的这条 loop：界面上画一条分隔线，不当成模型失败。 */
			interrupted: boolean;
			error: string | null;
	  }
	| { kind: "notice"; id: string; level: "info" | "warning" | "error"; text: string; timestamp: number };

/**
 * 已提交、模型还没取走的用户消息。两组按送达边界分开：steering 在下一个 step 边界送达，
 * followUp 等这一轮结束。正文是原始文本，附件块由界面自己剥（见 renderer/lib/pending.ts）。
 */
export type QueuedMessages = {
	steering: readonly string[];
	followUp: readonly string[];
};

/** 当前这一步在做的事；startedAt 是这一步自己的起点，换一步就换一个值。 */
export type RunActivity = {
	kind: "thinking" | "tool";
	/** 正在跑的工具名；思考时为 null。 */
	tool: string | null;
	startedAt: number;
};

export type AgentView = {
	model: string | null;
	modelName: string | null;
	thinkingLevel: ThinkingLevel;
	reasoning: boolean;
	status: AgentStatus;
	/** 运行中的当前步骤；空闲时为 null。 */
	activity: RunActivity | null;
	usage: UsageSummary | null;
	/** 已排队、还没送达模型的消息；空闲时也可能有（abort 之后留着等下一轮）。 */
	queued: QueuedMessages;
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
	/** 当前选中的 workspace；null 表示还没选，此时不能聊天。 */
	workspace: string | null;
	workspaces: WorkspaceSummary[];
	sessions: SessionSummary[];
	activeSessionId: string | null;
	transcript: TranscriptItem[];
	/** 当前会话里最后一次 todo 调用留下的清单；没用过 todo 就是空数组。 */
	todos: readonly TodoTaskView[];
	agent: AgentView;
	settings: DesktopSettings;
	/** 全部 workspace 的 issue；界面按当前 workspace 过滤。 */
	issues: IssueSummary[];
	issueRun: IssueRunView;
};

export type DesktopCommand =
	| { type: "refreshSessions" }
	| { type: "addWorkspace" }
	| { type: "selectWorkspace"; path: string }
	/** 新建会话；workspace 给出时先切到那个工作区（侧栏某个文件夹的右键菜单）。 */
	| { type: "newSession"; workspace?: string }
	| { type: "openSession"; id: string }
	| { type: "prompt"; text: string; attachments?: readonly PromptAttachment[] }
	| { type: "steer"; text: string }
	/** 撤回全部排队消息，文字由 main 用 draftRestore 交回输入框。 */
	| { type: "withdrawQueue" }
	| { type: "abort" }
	| { type: "renameSession"; id: string; title: string }
	| { type: "deleteSession"; id: string }
	| { type: "pinSession"; id: string; pinned: boolean }
	/** 开关某个会话的沉浸模式；sessionId 为 null 时作用在当前会话上。 */
	| { type: "setImmersive"; sessionId: string | null; immersive: boolean }
	| { type: "updateSettings"; patch: Partial<DesktopSettings> }
	| { type: "setModel"; model: string }
	| { type: "setThinkingLevel"; level: ThinkingLevel }
	| { type: "createIssue"; title: string; body: string }
	| { type: "updateIssue"; id: string; title?: string; body?: string }
	| { type: "commentIssue"; id: string; text: string }
	| { type: "deleteIssue"; id: string }
	/** 列表行的复选框与全选：勾上入队，取消出队。 */
	| { type: "setIssueQueue"; ids: readonly string[]; queued: boolean }
	| { type: "closeIssue"; id: string }
	| { type: "reopenIssue"; id: string }
	/** 取一条 issue 的正文与评论；结果走 issueDetail 事件。 */
	| { type: "selectIssue"; id: string }
	/** 切到这条 issue 的线程会话。 */
	| { type: "openIssueThread"; id: string }
	| { type: "runIssues"; action: "start" | "pause" | "stop" }
	| { type: "listModels" }
	/** 项目内文件搜索，给 composer 的 @ 引用补全用。 */
	| { type: "searchFiles"; requestId: number; query: string }
	/** 回答一次 ask_user；flowId 取自收到的 ask 事件。 */
	| { type: "askAnswer"; flowId: string; answers: Record<string, AskAnswer>; note?: string }
	/** 关掉一次提问而不作答：pi-ask 收到显式 cancel，那一轮立刻拿到结果，不必等到超时。 */
	| { type: "askCancel"; flowId: string }
	/** 标题栏右端的三颗窗口按钮：按钮由界面画，动作回 main 执行。 */
	| { type: "windowControl"; action: "minimize" | "maximize" | "close" }
	| { type: "openExternal"; url: string }
	/** 用系统默认程序打开一个文件。 */
	| { type: "openPath"; path: string }
	| { type: "revealPath"; path: string };

/**
 * 输入区的一份附件。图片连正文一起带走，模型直接看得到；其余文件只给路径，
 * 提示里列成 `<attached-files>` 块，由 agent 自己的文件工具去读。
 * 粘贴进来的图片没有磁盘路径，path 为 null。
 */
export type PromptAttachment =
	| { kind: "image"; name: string; path: string | null; mimeType: string; data: string; size: number }
	| { kind: "file"; name: string; path: string; size: number };

/** 一次提示最多带几个附件；选择器、拖入和托盘共用这一个上限。 */
export const MAX_ATTACHMENTS = 8;

/**
 * 内置图片查看器显示一张图需要的数据：data URL 自带媒介类型。
 * path 是图片在磁盘上的位置：粘贴进来的图片没有文件依赖它，此时为 null，没有“用外部程序打开”可做。
 */
export type ImageView = { path: string | null; name: string; dataUrl: string };

/**
 * 点开用户消息里一个附件的结果：图片给内置查看器，其余已经交给系统默认程序。
 * failed 表示系统也打不开，原因已经用 toast 报过了。
 */
export type FileOpenResult = { kind: "image"; image: ImageView } | { kind: "external" } | { kind: "failed" };

/**
 * issue 正文里一张图的解析结果：main 把路径或 URL 换成 data URL（渲染进程的 CSP 只放 data:），
 * 读不出来时给一句人话，界面上原地写在图的位置。
 */
export type IssueImage = { kind: "ready"; dataUrl: string } | { kind: "error"; message: string };

/**
 * 粘进正文的一张图：存成磁盘文件后，正文里只留这一行 markdown（绝对路径，哪个 workspace 都解析得到）；
 * 写盘失败时给原因，界面用 toast 报。
 */
export type PastedIssueImage = { kind: "ready"; markdown: string } | { kind: "error"; message: string };

/** pi-ask 的一道题里可选的答案。 */
export type AskOptionView = {
	value: string;
	label: string;
	description?: string;
	recommended?: boolean;
};

/** 一道题在界面上的样子；freeform 表示允许自己填一句。 */
export type AskQuestionView = {
	id: string;
	label: string;
	prompt: string;
	type: "single" | "multi" | "preview";
	required: boolean;
	freeform: boolean;
	options: AskOptionView[];
};

/** 一次 ask_user 提问；flowId 原样回传，是提交答案的唯一凭证。 */
export type AskRequest = {
	flowId: string;
	title: string | null;
	questions: AskQuestionView[];
	createdAt: number;
};

/** 一道题的作答：选项值、自填正文、或整题备注。 */
export type AskAnswer = {
	values?: string[];
	customText?: string;
	note?: string;
};

export type MenuAction = "newSession" | "addWorkspace" | "settings" | "search" | "toggleSidebar" | "closeSession";

export type DesktopEvent =
	/** 全量快照：初始化、切换会话、会话列表、设置或状态变化。 */
	| { type: "state"; state: DesktopState }
	/** 当前会话的结构性变化（消息开始/结束、工具开始/结束），流式内容也走快照。 */
	| { type: "transcript"; sessionId: string; items: TranscriptItem[] }
	/** 模型选择列表，按需重发，不跟每次状态快照走。 */
	| { type: "models"; models: ModelView[] }
	/** @ 引用补全的结果，requestId 对应发起的那次搜索。 */
	| { type: "files"; requestId: number; files: string[] }
	/** 原生菜单触发的动作，renderer 转成对应命令。 */
	| { type: "menu"; action: MenuAction }
	| { type: "window"; maximized: boolean }
	| { type: "toast"; level: "info" | "warning" | "error"; message: string }
	/** pi-ask 开始提问；按会话归属，每个会话最多同时一份。 */
	| { type: "ask"; sessionId: string; request: AskRequest }
	/** 提问已经结束（提交、取消或超时），界面上那一张应当收起。 */
	| { type: "askClosed"; sessionId: string; flowId: string }
	/** 撤回的队列消息回到输入框；草稿在 renderer 的 localStorage 里，所以只能这样送回来。 */
	| { type: "draftRestore"; sessionId: string; text: string }
	/** 选中那条 issue 的完整内容；null 表示它已经被删除。 */
	| { type: "issueDetail"; detail: IssueDetail | null };

export type DesktopBridge = {
	getState(): Promise<DesktopState>;
	send(command: DesktopCommand): Promise<void>;
	/** 读路径变成附件；不给路径时打开原生文件选择器。读不出的文件由 main 提示，这里只收结果。 */
	attachFiles(paths?: readonly string[]): Promise<PromptAttachment[]>;
	/** 拖进窗口的文件在磁盘上的位置；渲染进程自己拿不到 File.path。 */
	pathForFile(file: File): string;
	/** 点开用户消息里的一个附件：图片回给内置查看器，其余由 main 交给系统默认程序。 */
	openAttachment(path: string): Promise<FileOpenResult>;
	/** 取会话里某条用户消息的第 n 张图片（粘贴进来的图没有磁盘路径，只能从消息里读）。 */
	readMessageImage(sessionId: string, messageIndex: number, imageIndex: number): Promise<ImageView | null>;
	/** 读 issue 正文里一个图片地址：相对路径按 workspace 解析，URL 由 main 取回，结果一律是 data URL。 */
	resolveIssueImage(workspace: string | null, source: string): Promise<IssueImage>;
	/** 把粘贴的图片（base64）存到本地，回正文里该插的那行 markdown。 */
	savePastedImage(data: string): Promise<PastedIssueImage>;
	onEvent(listener: (event: DesktopEvent) => void): () => void;
};

export const IPC_GET_STATE = "pi-desktop:get-state";
export const IPC_ATTACH_FILES = "pi-desktop:attach-files";
export const IPC_OPEN_ATTACHMENT = "pi-desktop:open-attachment";
export const IPC_MESSAGE_IMAGE = "pi-desktop:message-image";
export const IPC_ISSUE_IMAGE = "pi-desktop:issue-image";
export const IPC_SAVE_ISSUE_IMAGE = "pi-desktop:save-issue-image";
export const IPC_COMMAND = "pi-desktop:command";
export const IPC_EVENT = "pi-desktop:event";
