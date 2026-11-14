// todo 工具卡片展开后的正文：被拒绝的那次把原因写在清单上面，清单本身由 TodoList 画。

import type { TodoCallView } from "../../../shared/contract.ts";
import { visibleTasks } from "../../lib/todo.ts";
import { TodoList } from "../todo/TodoList.tsx";

/** 一次 todo 调用的任务快照；清单只列没被删除的任务。 */
export function TodoCard({ todo }: { todo: TodoCallView }) {
	const tasks = visibleTasks(todo.tasks);
	return (
		<div className="todo-card">
			{todo.error ? <p className="todo-card-error">{todo.error}</p> : null}
			{tasks.length > 0 ? (
				<TodoList tasks={tasks} />
			) : todo.error ? null : (
				<p className="todo-card-empty">No tasks</p>
			)}
		</div>
	);
}
