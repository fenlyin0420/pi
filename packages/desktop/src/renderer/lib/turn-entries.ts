// 助手一轮回答的渲染单元：相邻的思考与工具调用合成一条活动链，整轮只留最后一段模型输出；
// 活动链那一条标题的文案也在这里算。

import type { AssistantPart, ToolCallView, TranscriptItem } from "../../shared/contract.ts";
import { lineTail } from "./format.ts";

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
 * 一轮回答的折叠：相邻的思考与工具调用并成一条活动行，文本按原位置显示。每个 step 的
 * 过程和它吐出的正文因此相邻，不会把中途的正文挤到最后。
 */
export function layoutTurn(items: readonly AssistantItem[], showThinking: boolean): TurnEntry[] {
	const entries: TurnEntry[] = [];
	for (const item of items) {
		for (const entry of buildTurnEntries(item.parts, showThinking)) {
			// 环节的 key 带上 item id：每个 loop 都从下标 0 重新编号。
			const blocks = entry.kind === "activity" ? entry.blocks.map((block) => withKey(item, block)) : [];
			if (entry.kind === "text") {
				entries.push({ kind: "text", key: `${item.id}-${entry.key}`, text: entry.text });
				continue;
			}
			const last = entries.at(-1);
			if (last?.kind === "activity") {
				// 中间没有文本，就是同一段过程：继续接在这条活动行上。
				last.blocks.push(...blocks);
				continue;
			}
			entries.push({ kind: "activity", key: `${item.id}-${entry.key}`, blocks });
		}
	}
	return entries;
}

/** 思考预览带上多少字：够长才能顶满一行，多出来的旧字会被标题裁掉。 */
const PREVIEW_CHARS = 240;

/** 粘进对话的截图落在临时目录里：路径又长又没信息量，预览里不说它。 */
const CLIPBOARD_TEMP = /pi-clipboard-[0-9a-f-]+\.\w+/;

/**
 * 运行中的预览。`tail` 是一直往前长的正文：按最新一段排满一行，最新的字贴着行尾；
 * `plain` 是一条短摘要。正文还没到时思考只说 Thinking。
 */
export type StepPreview = { kind: "tail"; text: string } | { kind: "plain"; text: string };

/**
 * 运行中的预览：这一环在做的事。思考给正文最新写下的一段，工具给一行调用摘要，
 * 临时截图只说“在读截图”。
 */
export function stepPreview(block: ActivityBlock | null): StepPreview {
	if (!block) return { kind: "plain", text: "Working" };
	if (block.kind === "thinking") {
		const tail = lineTail(block.text, PREVIEW_CHARS);
		return { kind: "tail", text: tail === "" ? "Thinking" : `Thinking · ${tail}` };
	}
	const call = block.calls.at(-1);
	if (!call) return { kind: "plain", text: "Working" };
	// 真正的路径留给结束后的工具卡片：展开就能看到，跑的时候不需要它在眼前。
	return { kind: "plain", text: CLIPBOARD_TEMP.test(call.summary) ? `${call.name} screenshot` : call.summary };
}

/** 静态摘要：先工具后思考，数量为 0 的部分不出现。 */
export function activitySummary(blocks: readonly ActivityBlock[]): string {
	let tools = 0;
	let thoughts = 0;
	for (const block of blocks) {
		if (block.kind === "thinking") thoughts += 1;
		else tools += block.calls.length;
	}
	const parts: string[] = [];
	if (tools > 0) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
	if (thoughts > 0) parts.push(thoughts === 1 ? "thought" : `${thoughts} thoughts`);
	return parts.join(" · ");
}

/** 给活动链里的环节加上所属 loop 的前缀。 */
function withKey(item: AssistantItem, block: ActivityBlock): ActivityBlock {
	return { ...block, key: `${item.id}-${block.key}` };
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
