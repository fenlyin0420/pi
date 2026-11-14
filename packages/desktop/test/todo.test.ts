// todo 清单派生的单元测试：墓碑不上清单、完成度只数清单上的任务、状态类名。

import { describe, expect, it } from "vitest";
import { statusClass, todoProgress, visibleTasks } from "../src/renderer/lib/todo.ts";
import type { TodoTaskView } from "../src/shared/contract.ts";

function task(id: number, status: TodoTaskView["status"], subject = `task ${id}`): TodoTaskView {
	return { id, subject, status, activeForm: null, blockedBy: [] };
}

const TASKS = [task(1, "completed"), task(2, "deleted"), task(3, "in_progress"), task(4, "pending")];

describe("visibleTasks", () => {
	it("墓碑不显示，其余按原顺序保留", () => {
		expect(visibleTasks(TASKS).map((item) => item.id)).toEqual([1, 3, 4]);
	});
});

describe("todoProgress", () => {
	it("完成度只数清单上的任务", () => {
		expect(todoProgress(TASKS)).toEqual({ done: 1, total: 3 });
	});

	it("清单空了就不报完成度", () => {
		expect(todoProgress([])).toBeNull();
		expect(todoProgress([task(1, "deleted")])).toBeNull();
	});
});

describe("statusClass", () => {
	it("下划线翻成连字符", () => {
		expect(statusClass(task(3, "in_progress"))).toBe("is-in-progress");
		expect(statusClass(task(1, "completed"))).toBe("is-completed");
	});
});
