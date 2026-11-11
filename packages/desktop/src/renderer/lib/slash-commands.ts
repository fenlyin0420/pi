// 斜杠命令表：命令名、说明，以及执行时交给 Composer 去做的动作。

/** 命令的动作只是意图名，真正的回调由 Composer 持有，命令表保持纯数据。 */
export type SlashAction = "newSession" | "openModel" | "openThinking" | "openSettings" | "abort" | "clearDraft";

export type SlashCommand = {
	/** 命令名，不带斜杠；也用作列表的 key。 */
	id: string;
	/** 输入框里敲的写法，带斜杠。 */
	label: string;
	description: string;
	/** 只在 agent 运行时可用的命令。 */
	runningOnly: boolean;
	action: SlashAction;
};

const SLASH_COMMANDS: readonly SlashCommand[] = [
	{ id: "new", label: "/new", description: "Start a new session", runningOnly: false, action: "newSession" },
	{ id: "model", label: "/model", description: "Switch model", runningOnly: false, action: "openModel" },
	{
		id: "thinking",
		label: "/thinking",
		description: "Switch thinking level",
		runningOnly: false,
		action: "openThinking",
	},
	{ id: "settings", label: "/settings", description: "Open settings", runningOnly: false, action: "openSettings" },
	{ id: "stop", label: "/stop", description: "Stop the current run", runningOnly: true, action: "abort" },
	{ id: "clear", label: "/clear", description: "Clear the draft", runningOnly: false, action: "clearDraft" },
];

/**
 * 输入框以 `/` 开头的裸命令词返回查询串，否则返回 null：一旦写入空格就是正文，
 * 正文里出现的斜杠不该再弹出面板。
 */
export function slashQuery(value: string): string | null {
	if (!value.startsWith("/")) return null;
	const query = value.slice(1);
	return /\s/.test(query) ? null : query;
}

/** 当前可用的命令；运行态下多出 /stop。顺序即面板顺序。 */
export function availableSlashCommands(running: boolean): readonly SlashCommand[] {
	return SLASH_COMMANDS.filter((command) => !command.runningOnly || running);
}

/** 按命令名前缀过滤；空查询给出全部可用命令。 */
export function matchSlashCommands(query: string, running: boolean): readonly SlashCommand[] {
	const needle = query.toLowerCase();
	return availableSlashCommands(running).filter((command) => command.id.startsWith(needle));
}
