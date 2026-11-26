// 当前会话的 todo 状态条：贴在输入框上方报一行进度，展开是完整清单；没有任务时整条不画。

import { useState } from "react";
import type { TodoTaskView } from "../../../shared/contract.ts";
import { IconChevronRight } from "../../icons.tsx";
import { todoProgress, visibleTasks } from "../../lib/todo.ts";
import { cx } from "../../ui.tsx";
import { TodoList } from "./TodoList.tsx";

type TodoDockProps = {
	/** 会话里最后一次 todo 调用的清单，来自状态快照。 */
	tasks: readonly TodoTaskView[];
};

/**
 * 收起时一行：`Todos 2/5` 加正在做（或下一条待办）的主题；展开就是清单。
 * 清单来自工具结果快照，所以它是“现在”的样子，翻历史仍然看对话里的每张卡片。
 */
export function TodoDock({ tasks }: TodoDockProps) {
	// 展开与否是读者当下的选择，不进设置：切会话时按收起重新算。
	const [open, setOpen] = useState(false);
	const visible = visibleTasks(tasks);
	const progress = todoProgress(visible);
	if (!progress) return null;
	const current =
		visible.find((task) => task.status === "in_progress") ?? visible.find((task) => task.status === "pending");
	return (
		<div className={cx("todo-dock", open && "open")}>
			<button type="button" className="todo-dock-head" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className="todo-dock-label">Todos</span>
				<span className="todo-dock-count">
					{progress.done}/{progress.total}
				</span>
				{open ? null : <span className="todo-dock-current">{current?.subject ?? "All done"}</span>}
				<span className="todo-dock-caret" aria-hidden>
					<IconChevronRight size={12} />
				</span>
			</button>
			{open ? <TodoList tasks={visible} /> : null}
		</div>
	);
}
