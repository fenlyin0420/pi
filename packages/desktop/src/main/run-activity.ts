// 运行状态行的数据来源：把“谁在跑、从什么时候开始”存成不可变快照，显示时再派生成当前这一步。

import type { RunActivity } from "../shared/contract.ts";

type RunningTool = { tool: string; startedAt: number };

export type RunSteps = { tools: ReadonlyMap<string, RunningTool>; thinkingSince: number | null };

/** 空闲：没有工具在跑，也不在思考。模块级常量，所有派生函数都返回新对象，没人改它。 */
export const idleSteps: RunSteps = { tools: new Map(), thinkingSince: null };

/** 开始时就是一段思考：整轮的第一个 run 事件回来之前，状态行也要有话说。 */
export function thinkingSteps(now: number): RunSteps {
	return { tools: new Map(), thinkingSince: now };
}

/** 记下一件工具的开始时间；同一批次里已经在跑的其它工具保持原样。 */
export function toolStarted(steps: RunSteps, toolCallId: string, tool: string, now: number): RunSteps {
	const tools = new Map(steps.tools);
	tools.set(toolCallId, { tool, startedAt: now });
	return { tools, thinkingSince: steps.thinkingSince };
}

/** 结束一件工具：删掉它；最后一件结束时思考从这一刻重新计时，否则保留原来的思考起点。 */
export function toolEnded(steps: RunSteps, toolCallId: string, now: number): RunSteps {
	const tools = new Map(steps.tools);
	const removed = tools.delete(toolCallId);
	// 收到一件我们没记录过开始的结束事件时不重起计时：否则会凭空造出一个思考步。
	return { tools, thinkingSince: removed && tools.size === 0 ? now : steps.thinkingSince };
}

/**
 * 当前这一步：并行批次里取最早启动的那件工具——它是读者最先看到、也最可能一直没结束的那一步；
 * 没有工具在跑时退回思考；两者都没有就是空。
 */
export function stepActivity(steps: RunSteps): RunActivity | null {
	let earliest: RunningTool | null = null;
	for (const running of steps.tools.values()) {
		if (earliest === null || running.startedAt < earliest.startedAt) earliest = running;
	}
	if (earliest) return { kind: "tool", tool: earliest.tool, startedAt: earliest.startedAt };
	if (steps.thinkingSince !== null) return { kind: "thinking", tool: null, startedAt: steps.thinkingSince };
	return null;
}
