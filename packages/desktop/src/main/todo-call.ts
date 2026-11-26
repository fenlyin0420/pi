// pi-todo 的 todo 工具结果 → 界面用的任务快照；形状对不上的 details 一律不认。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TodoCallView, TodoStatus, TodoTaskView } from "../shared/contract.ts";

/**
 * pi-todo 注册的工具名。它同时是那边分支重放与权限表的键，两边改名要一起改。
 */
const TODO_TOOL = "todo";

const STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed", "deleted"];

/**
 * 读一次 todo 工具调用留下的任务快照。details 是别的包写进会话文件的 JSON（也可能是同名工具
 * 的别的形状），所以这里逐字段验；认不出来就返回 null，卡片按普通工具画。
 */
export function readTodoCall(name: string, details: unknown): TodoCallView | null {
	if (name !== TODO_TOOL || !isRecord(details) || !Array.isArray(details.tasks)) return null;
	const tasks: TodoTaskView[] = [];
	// 单条坏掉只丢那一条：整份快照丢掉会让卡片退回一坨参数 JSON。
	for (const value of details.tasks) {
		const task = readTask(value);
		if (task) tasks.push(task);
	}
	return { tasks, error: typeof details.error === "string" && details.error !== "" ? details.error : null };
}

/**
 * 会话里最后一次 todo 调用留下的清单，给输入框上方那条状态条用；没用过 todo 就是空数组。
 * 每次状态快照都会调一次，所以从末尾找、找到就停；只有最后那次的结果读不出来才往回多走几步。
 */
export function latestTodoTasks(messages: readonly AgentMessage[]): readonly TodoTaskView[] {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "toolResult" || message.toolName !== TODO_TOOL) continue;
		const call = readTodoCall(TODO_TOOL, message.details);
		if (call) return call.tasks;
	}
	return [];
}

function readTask(value: unknown): TodoTaskView | null {
	if (!isRecord(value)) return null;
	const { id, subject, status } = value;
	if (typeof id !== "number" || typeof subject !== "string" || !isStatus(status)) return null;
	return {
		id,
		subject,
		status,
		activeForm: typeof value.activeForm === "string" && value.activeForm !== "" ? value.activeForm : null,
		blockedBy: Array.isArray(value.blockedBy)
			? value.blockedBy.filter((dependency): dependency is number => typeof dependency === "number")
			: [],
	};
}

function isStatus(value: unknown): value is TodoStatus {
	return STATUSES.some((status) => status === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
