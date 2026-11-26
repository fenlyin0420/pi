// 任务清单：todo 工具卡片和输入框上方的状态条共用这一份排版。

import type { TodoTaskView } from "../../../shared/contract.ts";
import { IconCheck, IconCircle, IconLoader } from "../../icons.tsx";
import { statusClass } from "../../lib/todo.ts";
import { cx } from "../../ui.tsx";

/** 一张任务清单；调用方已经滤掉墓碑，这里只管画。 */
export function TodoList({ tasks }: { tasks: readonly TodoTaskView[] }) {
	return (
		<ul className="todo-list">
			{tasks.map((task) => (
				<TodoTask key={task.id} task={task} />
			))}
		</ul>
	);
}

/** 一行任务：状态图标、主题，进行中的那条再带进行时标签，有依赖的报出来等谁。 */
function TodoTask({ task }: { task: TodoTaskView }) {
	return (
		<li className={cx("todo-task", statusClass(task))}>
			<span className="todo-task-mark" aria-hidden>
				{taskMark(task)}
			</span>
			<span className="todo-task-subject">{task.subject}</span>
			{task.status === "in_progress" && task.activeForm ? (
				<span className="todo-task-form">{task.activeForm}</span>
			) : null}
			{task.blockedBy.length > 0 ? (
				<span className="todo-task-blocked">{`blocked by ${task.blockedBy.map((id) => `#${id}`).join(", ")}`}</span>
			) : null}
		</li>
	);
}

/** 状态图标：完成打勾，进行中转圈，待办空心；墓碑不上清单，这里不会出现。 */
function taskMark(task: TodoTaskView) {
	switch (task.status) {
		case "completed":
			return <IconCheck size={12} />;
		case "in_progress":
			return <IconLoader size={12} />;
		case "deleted":
		case "pending":
			return <IconCircle size={12} />;
	}
}
