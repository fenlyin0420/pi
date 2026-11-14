// 会话消息到 transcript 契约的纯映射。pi 类型只做 type-only 引入，运行时不依赖 pi。

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { splitAttachedFiles } from "../shared/attached-files.ts";
import type { AssistantPart, ToolCallView, ToolDiffView, TranscriptItem, TurnUsage } from "../shared/contract.ts";

const SUMMARY_LIMIT = 140;
const ARGS_LIMIT = 6_000;
const RESULT_LIMIT = 24_000;
/** 单次改文件的前/后文本上限：轮末卡片和右栏 diff 都从这份文本算，太小会把大文件写成空动作。 */
const DIFF_LIMIT = 24_000;
const PREVIEW_LIMIT = 200;

/** 只读结构里用到的块字段；未识别的块类型由 type 过滤掉。 */
type ContentBlock = { type: string; text?: string };

type ToolResultInfo = { text: string; images: number; isError: boolean };

export type TranscriptOptions = {
	/** 正在接收模型输出的消息下标；只有这一条会被标成 streaming。 */
	streamingIndex: number | null;
	/** 工具调用 id 到执行耗时，由 host 计时，消息本身不带。 */
	toolDurations?: ReadonlyMap<string, number>;
	/**
	 * 已经起跑、还没出结果的工具调用 id。消息落地之后，没有结果既可能是排队也可能是正在跑，
	 * 只有 host 的步骤状态分得清，所以由它传进来。
	 */
	runningToolIds?: ReadonlyMap<string, unknown>;
};

/** 消息下标到 item id：同一个下标在所有快照和增量里指向同一个 item。 */
export function itemIdAt(index: number): string {
	return `msg-${index}`;
}

/**
 * 把一次会话的消息投影成 transcript。
 *
 * 工具结果不单独成行：它并进对应的工具卡片，卡片状态由结果决定。`streamingIndex`
 * 指向正在生成的那条 assistant 消息，它的未完成工具调用显示为 running。
 */
export function toTranscriptItems(messages: readonly AgentMessage[], options: TranscriptOptions): TranscriptItem[] {
	const results = collectToolResults(messages);
	const items: TranscriptItem[] = [];

	for (const [index, message] of messages.entries()) {
		const id = itemIdAt(index);
		switch (message.role) {
			case "user": {
				const images = Array.isArray(message.content)
					? message.content.filter((block) => block.type === "image").length
					: 0;
				// 附件块是给模型看的路径清单，气泡里换成 chips，正文只留用户自己写的
				const { text, files } = splitAttachedFiles(joinText(message.content));
				items.push({
					kind: "user",
					id,
					text,
					timestamp: message.timestamp,
					imageCount: images,
					files,
					messageIndex: index,
				});
				break;
			}
			case "assistant": {
				// pi 把用户打断也落成一条 assistant 记录（stopReason "aborted" 加
				// "Operation aborted" 之类的 errorMessage）。那是状态不是失败：
				// 界面对它画分隔线，所以这里不把 abort 的原因当成错误交下去。
				const interrupted = message.stopReason === "aborted";
				items.push({
					kind: "assistant",
					id,
					parts: toParts(message, results, options, index === options.streamingIndex),
					timestamp: message.timestamp,
					streaming: index === options.streamingIndex,
					model: `${message.provider}/${message.model}`,
					usage: toTurnUsage(message),
					interrupted,
					error: interrupted ? null : (message.errorMessage ?? null),
				});
				break;
			}
			case "bashExecution": {
				const exit = message.exitCode === undefined ? "" : ` (exit ${message.exitCode})`;
				items.push({
					kind: "notice",
					id,
					level:
						message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0) ? "error" : "info",
					text: truncate(`$ ${message.command}${exit}\n${message.output}`.trim(), RESULT_LIMIT),
					timestamp: message.timestamp,
				});
				break;
			}
			default:
				// toolResult 已并进工具卡片；system 和自定义消息不进对话。
				break;
		}
	}

	return items;
}

/** 纯文本投影，搜索结果和复制全文用。 */
export function transcriptToText(items: readonly TranscriptItem[]): string {
	const chunks: string[] = [];
	for (const item of items) {
		if (item.kind === "user") chunks.push(`User:\n${item.text}`);
		else if (item.kind === "notice") chunks.push(item.text);
		else {
			for (const part of item.parts) {
				if (part.type === "text" && part.text.trim()) chunks.push(part.text);
				else if (part.type === "thinking" && part.text.trim()) chunks.push(part.text);
			}
		}
	}
	return chunks.join("\n\n");
}

function toParts(
	message: Extract<AgentMessage, { role: "assistant" }>,
	results: ReadonlyMap<string, ToolResultInfo>,
	options: TranscriptOptions,
	streaming: boolean,
): AssistantPart[] {
	const parts: AssistantPart[] = [];
	for (const [blockIndex, block] of message.content.entries()) {
		if (block.type === "text") {
			parts.push({ type: "text", text: block.text });
		} else if (block.type === "thinking") {
			parts.push({ type: "thinking", text: block.redacted ? "[redacted]" : block.thinking });
		} else if (block.type === "toolCall") {
			const result = results.get(block.id);
			const running = options.runningToolIds?.has(block.id) === true;
			const call: ToolCallView = {
				id: `tool-${blockIndex}`,
				name: block.name,
				state: result ? (result.isError ? "error" : "done") : running || streaming ? "running" : "pending",
				summary: summarizeToolCall(block.name, block.arguments),
				argsText: formatArguments(block.name, block.arguments),
				resultText: result ? truncate(withImageNote(result.text, result.images), RESULT_LIMIT) : "",
				diff: toolDiff(block.name, block.arguments),
				durationMs: options.toolDurations?.get(block.id) ?? null,
			};
			parts.push({ type: "tool", call });
		}
	}
	return parts;
}

/** 工具调用 id 到结果正文；同名工具并行时按 id 区分。 */
function collectToolResults(messages: readonly AgentMessage[]): Map<string, ToolResultInfo> {
	const results = new Map<string, ToolResultInfo>();
	for (const message of messages) {
		if (message.role !== "toolResult") continue;
		const images = Array.isArray(message.content)
			? message.content.filter((block) => block.type === "image").length
			: 0;
		results.set(message.toolCallId, {
			text: joinText(message.content),
			images,
			isError: message.isError === true,
		});
	}
	return results;
}

function toTurnUsage(message: Extract<AgentMessage, { role: "assistant" }>): TurnUsage | null {
	const usage = message.usage;
	if (!usage) return null;
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cost: usage.cost?.total ?? 0,
		durationMs: message.durationMs ?? null,
	};
}

/** 一行摘要：先按工具挑最像命令的那个参数，再退回第一个字符串参数。 */
function summarizeToolCall(name: string, args: Record<string, unknown>): string {
	const preferred = preferredArgument(name, args);
	const value = preferred ?? firstString(args);
	const line = value ? `${name} ${value}` : name;
	return truncate(line.replace(/\s+/g, " "), SUMMARY_LIMIT);
}

function preferredArgument(name: string, args: Record<string, unknown>): string | null {
	const read = (key: string): string | null => {
		const value = args[key];
		return typeof value === "string" && value.length > 0 ? value : null;
	};
	switch (name) {
		case "bash":
			return read("command");
		case "read":
		case "write":
		case "edit":
		case "ls":
			return read("path");
		case "grep":
		case "find":
			return read("pattern") ?? read("path");
		case "web_fetch":
		case "fetch":
			return read("url");
		case "web_search":
			return read("query");
		case "task":
			return read("description");
		default:
			return null;
	}
}

function formatArguments(name: string, args: Record<string, unknown>): string {
	if (name === "bash" && typeof args.command === "string") return `$ ${args.command}`;
	try {
		return truncate(JSON.stringify(args, null, 2), ARGS_LIMIT);
	} catch {
		return "";
	}
}

/** edit/write 的行内 diff 数据来源；其他工具不产生 diff。 */
function toolDiff(name: string, args: Record<string, unknown>): ToolDiffView | null {
	const path = typeof args.path === "string" ? args.path : "";
	if (!path) return null;
	if (name === "write" && typeof args.content === "string") {
		// write 只带新文：读旧文件的是工具自己，映射层不去碰磁盘，所以旧文按空算（新文件就是全部新增）
		const after = clip(args.content);
		return { path, before: "", after: after.text, truncated: after.cut };
	}
	if (name !== "edit") return null;
	const edits = Array.isArray(args.edits) ? args.edits : [];
	const normalized = edits
		.filter((edit): edit is { oldText: string; newText: string } => isReplaceEdit(edit))
		.map((edit) => ({ oldText: edit.oldText, newText: edit.newText }));
	if (normalized.length === 0) {
		const oldText = typeof args.oldString === "string" ? args.oldString : null;
		const newText = typeof args.newString === "string" ? args.newString : null;
		if (oldText !== null && newText !== null) normalized.push({ oldText, newText });
	}
	if (normalized.length === 0) return null;
	const before = clip(normalized.map((edit) => edit.oldText).join("\n…\n"));
	const after = clip(normalized.map((edit) => edit.newText).join("\n…\n"));
	return { path, before: before.text, after: after.text, truncated: before.cut || after.cut };
}

/** 截到 diff 上限，并报出是否截过：界面据此说明“看到的只是开头一段”。 */
function clip(text: string): { text: string; cut: boolean } {
	return text.length > DIFF_LIMIT ? { text: `${text.slice(0, DIFF_LIMIT)}…`, cut: true } : { text, cut: false };
}

function isReplaceEdit(value: unknown): value is { oldText: string; newText: string } {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.oldText === "string" && typeof record.newText === "string";
}

function joinText(content: string | readonly ContentBlock[] | undefined): string {
	if (typeof content === "string") return content;
	if (!content) return "";
	return content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

function firstString(args: Record<string, unknown>): string | null {
	for (const value of Object.values(args)) {
		if (typeof value === "string" && value.length > 0) return value;
	}
	return null;
}

function withImageNote(text: string, images: number): string {
	if (images === 0) return text;
	return `${text}\n[${images} image${images > 1 ? "s" : ""}]`.trim();
}

function truncate(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 预览行：单条消息压成不含换行的短句。 */
export function previewLine(text: string): string {
	return truncate(text.replace(/\s+/g, " ").trim(), PREVIEW_LIMIT);
}
