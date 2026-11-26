// todo 清单在界面上的派生：列出哪些任务、完成了几条，以及每行用哪个状态类名。

import type { TodoTaskView } from "../../shared/contract.ts";

/** 清单上显示的任务：墓碑（deleted）只为历史里的依赖引用留着，不上清单。 */
export function visibleTasks(tasks: readonly TodoTaskView[]): readonly TodoTaskView[] {
	return tasks.filter((task) => task.status !== "deleted");
}

/** 完成度：已完成几条、共几条；没有可显示的任务时返回 null，界面上不画进度。 */
export function todoProgress(tasks: readonly TodoTaskView[]): { done: number; total: number } | null {
	const visible = visibleTasks(tasks);
	if (visible.length === 0) return null;
	return { done: visible.filter((task) => task.status === "completed").length, total: visible.length };
}

/** 一行任务的状态类名：`is-completed`、`is-in-progress`… */
export function statusClass(task: TodoTaskView): string {
	return `is-${task.status.replace("_", "-")}`;
}
