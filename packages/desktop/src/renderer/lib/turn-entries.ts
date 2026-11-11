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
 * 整轮折叠：所有 loop 的思考与工具调用并进一条活动链（位置在第一次出现活动的地方），
 * 文本照旧按原位一段段显示——模型中途输出的正文不该被折进去。
 */
export function layoutTurn(items: readonly AssistantItem[], showThinking: boolean): TurnEntry[] {
	const entries: TurnEntry[] = [];
	// 活动链只建一次，后续 loop 的环节继续往里加。
	let chain: ActivityBlock[] | null = null;
	for (const item of items) {
		for (const entry of buildTurnEntries(item.parts, showThinking)) {
			if (entry.kind === "text") {
				entries.push({ kind: "text", key: `${item.id}-${entry.key}`, text: entry.text });
				continue;
			}
			if (chain === null) {
				chain = [];
				entries.push({ kind: "activity", key: `${item.id}-${entry.key}`, blocks: chain });
			}
			// 环节的 key 也要带上 item id：每个 loop 都从下标 0 重新编号。
			for (const block of entry.blocks) chain.push({ ...block, key: `${item.id}-${block.key}` });
		}
	}
	return entries;
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
