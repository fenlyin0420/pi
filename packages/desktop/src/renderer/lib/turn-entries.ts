// 助手一轮回答的渲染单元：相邻的思考与工具调用合成一条活动链，整轮只留最后一段模型输出。

import type { AssistantPart, ToolCallView, TranscriptItem } from "../../shared/contract.ts";

type AssistantItem = Extract<TranscriptItem, { kind: "assistant" }>;

/** 活动链里的一环：一段思考，或一组相邻的工具调用。 */
export type ActivityBlock =
	| { kind: "thinking"; key: string; text: string }
	| { kind: "tools"; key: string; calls: ToolCallView[] };

/** 一轮回答按顺序渲染的东西。 */
export type TurnEntry =
	| { kind: "text"; key: string; text: string }
	| { kind: "activity"; key: string; blocks: ActivityBlock[] };

/** 一轮回答最终露在外面的两样：折进活动行的过程，和最后一段模型输出。 */
export type TurnLayout = {
	activity: TurnEntry[];
	output: Extract<TurnEntry, { kind: "text" }> | null;
};

/** transcript 的渲染块：一条独立记录，或整轮回答（用户两句话之间的全部 loop）。 */
export type TranscriptBlock =
	| { kind: "item"; key: string; item: Exclude<TranscriptItem, { kind: "assistant" }> }
	| { kind: "turn"; key: string; items: AssistantItem[] };

/**
 * 把相邻的 assistant 记录并成一轮：一次提问会来回好几个 loop（每次都是一条 assistant
 * 记录），它们是同一轮的过程，收起时应当只有一行。用户消息和系统提示各自成块。
 */
export function groupTranscript(items: readonly TranscriptItem[]): TranscriptBlock[] {
	const blocks: TranscriptBlock[] = [];
	for (const item of items) {
		const last = blocks.at(-1);
		if (item.kind === "assistant") {
			if (last?.kind === "turn") last.items.push(item);
			else blocks.push({ kind: "turn", key: item.id, items: [item] });
			continue;
		}
		blocks.push({ kind: "item", key: item.id, item });
	}
	return blocks;
}

/**
 * 把 parts 折成渲染单元：空文本跳过，相邻的工具调用并进同一组，连续的思考/工具合成
 * 一条活动链。key 用该单元第一个 part 的下标，parts 只追加不改位，同一段内容始终拿到
 * 同一个 key。
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
		const open = last?.kind === "activity" ? last.blocks.at(-1) : undefined;
		if (open?.kind === "tools") open.calls.push(part.call);
		else pushBlock(entries, { kind: "tools", key: `tools-${index}`, calls: [part.call] });
	}
	return entries;
}

/**
 * 整轮折叠：前面每个 loop 的思考、工具与草稿都折进活动行，只有最后一个 loop 的最后一段
 * 文本留在外面。最后一个 loop 没有文本时（还在跑工具）输出为空，活动行就是全部。
 */
export function layoutTurn(items: readonly AssistantItem[], showThinking: boolean): TurnLayout {
	const lastIndex = items.length - 1;
	const activity: TurnEntry[] = [];
	for (const [index, item] of items.entries()) {
		const entries = buildTurnEntries(item.parts, showThinking);
		if (index < lastIndex) {
			activity.push(...entries);
			continue;
		}
		const layout = layoutTurnEntries(entries);
		activity.push(...layout.activity);
		return { activity, output: layout.output };
	}
	return { activity, output: null };
}

/** 一段 entries 里最后那段文本留在外面，其余都进活动行。 */
function layoutTurnEntries(entries: readonly TurnEntry[]): TurnLayout {
	let outputIndex = -1;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		if (entries[index].kind === "text") {
			outputIndex = index;
			break;
		}
	}
	if (outputIndex < 0) return { activity: [...entries], output: null };
	const output = entries[outputIndex] as Extract<TurnEntry, { kind: "text" }>;
	return { activity: entries.filter((_, index) => index !== outputIndex), output };
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
