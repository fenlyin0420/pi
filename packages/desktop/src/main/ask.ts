// pi-ask 事件桥：把扩展发在 pi.events 上的提问转成界面契约，并把答案发回同一个订阅通道。

import type { AskAnswer, AskOptionView, AskQuestionView, AskRequest } from "../shared/contract.ts";

/** 扩展在 `pi.events` 上使用的四个通道（见 pi-ask 的 docs/remote-events.md）。 */
export const PI_ASK_STARTED = "@eko24ive/pi-ask:started";
export const PI_ASK_COMPLETED = "@eko24ive/pi-ask:completed";
export const PI_ASK_SUBMIT = "@eko24ive/pi-ask:submit";

/** 提交事件的版本号，pi-ask 只认 1。 */
const SUBMIT_VERSION = 1;

/** 从 started/completed 事件里取 flowId；取不到就是不属于这次提问的载荷。 */
export function flowIdOf(data: unknown): string | null {
	if (!isRecord(data)) return null;
	return typeof data.flowId === "string" && data.flowId !== "" ? data.flowId : null;
}

/**
 * 把 started 事件读成界面契约。信任边界是扩展的 wire 数据：字段缺失或类型不对就整条丢弃，
 * 不猜半个问题出来。
 */
export function toAskRequest(data: unknown): AskRequest | null {
	if (!isRecord(data) || typeof data.flowId !== "string" || data.flowId === "") return null;
	if (!Array.isArray(data.questions)) return null;
	const questions: AskQuestionView[] = [];
	for (const raw of data.questions) {
		const question = toQuestion(raw);
		if (!question) return null;
		questions.push(question);
	}
	if (questions.length === 0) return null;
	return {
		flowId: data.flowId,
		title: typeof data.title === "string" && data.title.trim() !== "" ? data.title.trim() : null,
		questions,
		createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
	};
}

/** 提交事件的主体：答案按题目 id 索引，note 是整次提问的备注。 */
export function toSubmitPayload(flowId: string, answers: Record<string, AskAnswer>, note?: string) {
	const mapped: Record<string, { values?: string[]; customText?: string; note?: string }> = {};
	for (const [questionId, answer] of Object.entries(answers)) {
		const entry: { values?: string[]; customText?: string; note?: string } = {};
		if (answer.values && answer.values.length > 0) entry.values = answer.values;
		if (answer.customText && answer.customText.trim() !== "") entry.customText = answer.customText.trim();
		if (answer.note && answer.note.trim() !== "") entry.note = answer.note.trim();
		if (Object.keys(entry).length > 0) mapped[questionId] = entry;
	}
	return {
		version: SUBMIT_VERSION,
		requestId: `desktop-${Date.now()}`,
		flowId,
		response: {
			kind: "answer" as const,
			mode: "submit" as const,
			answers: mapped,
			...(note && note.trim() !== "" ? { note: note.trim() } : {}),
		},
	};
}

/** 关掉一次提问：pi-ask 只认显式 cancel，不答也不取消就只能等它十分钟超时。 */
export function toCancelPayload(flowId: string) {
	return {
		version: SUBMIT_VERSION,
		requestId: `desktop-${Date.now()}`,
		flowId,
		response: { kind: "cancel" as const },
	};
}

function toQuestion(raw: unknown): AskQuestionView | null {
	if (!isRecord(raw)) return null;
	const { id, prompt } = raw;
	if (typeof id !== "string" || typeof prompt !== "string") return null;
	if (!Array.isArray(raw.options)) return null;
	const options: AskOptionView[] = [];
	for (const option of raw.options) {
		if (!isRecord(option)) return null;
		if (typeof option.value !== "string" || typeof option.label !== "string") return null;
		options.push({
			value: option.value,
			label: option.label,
			...(typeof option.description === "string" ? { description: option.description } : {}),
			...(option.recommended === true ? { recommended: true } : {}),
		});
	}
	const type = raw.type === "multi" || raw.type === "preview" ? raw.type : "single";
	return {
		id,
		label: typeof raw.label === "string" ? raw.label : "Question",
		prompt,
		type,
		required: raw.required !== false,
		// 题型是 preview 或选项里带 freeform 时，允许自己填一句。
		freeform: type === "preview" || raw.options.some((option) => isRecord(option) && option.freeform === true),
		options,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
