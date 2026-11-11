// 助手一轮回答的渲染单元：相邻的思考与工具调用合成一条活动链，文本各自成段。

import type { AssistantPart, ToolCallView } from "../../shared/contract.ts";

/** 活动链里的一环：一段思考，或一组相邻的工具调用。 */
export type ActivityBlock =
	| { kind: "thinking"; key: string; text: string }
	| { kind: "tools"; key: string; calls: ToolCallView[] };

/** 一轮回答按顺序渲染的东西。 */
export type TurnEntry =
	| { kind: "text"; key: string; text: string }
	| { kind: "thinking"; key: string; text: string }
	| { kind: "tool"; key: string; call: ToolCallView }
	| { kind: "activity"; key: string; blocks: ActivityBlock[] };

/**
 * 把 parts 折成渲染单元：空文本跳过，相邻的工具调用并进同一组，再让连续的思考/工具
 * 合流成一条活动链。key 用该单元第一个 part 的下标，parts 只追加不改位，同一段内容
 * 始终拿到同一个 key。单环的活动链（一次工具调用或一段思考）不套壳，直接铺开。
 */
export function buildTurnEntries(parts: readonly AssistantPart[], showThinking: boolean): TurnEntry[] {
	const entries: TurnEntry[] = [];
	for (const [index, part] of parts.entries()) {
		if (part.type === "text") {
			if (part.text === "") continue;
			entries.push({ kind: "text", key: `text-${index}`, text: part.text });
			continue;
		}
		// 关掉“显示思考”后整块不进链路，也不留占位。
		if (part.type === "thinking" && !showThinking) continue;
		if (part.type === "thinking") {
			pushBlock(entries, { kind: "thinking", key: `thinking-${index}`, text: part.text });
			continue;
		}
		const last = entries.at(-1);
		const chain = last?.kind === "activity" ? last.blocks.at(-1) : undefined;
		if (chain?.kind === "tools") chain.calls.push(part.call);
		else pushBlock(entries, { kind: "tools", key: `tools-${index}`, calls: [part.call] });
	}

	// 单环不套壳：一行工具卡片或一块思考本来就是完整的展示单位。
	return entries.map((entry) => {
		if (entry.kind !== "activity" || entry.blocks.length !== 1) return entry;
		const [block] = entry.blocks;
		if (block.kind === "thinking") return { kind: "thinking", key: block.key, text: block.text };
		if (block.calls.length === 1) return { kind: "tool", key: block.key, call: block.calls[0] };
		return entry;
	});
}

/** 追加一环：接在已有的活动链后面，否则新开一条链。 */
function pushBlock(entries: TurnEntry[], block: ActivityBlock): void {
	const last = entries.at(-1);
	if (last?.kind === "activity") {
		last.blocks.push(block);
		return;
	}
	entries.push({ kind: "activity", key: `activity-${block.key}`, blocks: [block] });
}
