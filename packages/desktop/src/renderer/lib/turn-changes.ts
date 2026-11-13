// 一轮回答改过的文件：把这一轮所有 edit/write 调用按路径折起来，算净增减行数。

import type { TranscriptItem } from "../../shared/contract.ts";
import { diffLines } from "./diff.ts";

type AssistantItem = Extract<TranscriptItem, { kind: "assistant" }>;

/** 一轮里改过的一个文件：第一次改之前的原文、最后一次改之后的全文，以及行级增减。 */
export type TurnFileChange = {
	/** 工具调用里写的路径，原样保留（相对或绝对由模型决定）。 */
	path: string;
	added: number;
	deleted: number;
	before: string;
	after: string;
	/** 原文或新文被 diff 上限截过：增减行数与正文都只算看得见的那一段。 */
	truncated: boolean;
};

/**
 * 把一轮（用户两句话之间的所有 loop）里的改文件调用折成清单，按第一次动到的顺序排列。
 *
 * 同一路径只留一条：原文取第一次改之前的，新文取最后一次改之后的。于是同一个文件被反复
 * 改也只是一次净变化——按每次调用的增减相加会把改过好几遍的行算好几遍。
 */
export function turnChanges(items: readonly AssistantItem[]): TurnFileChange[] {
	const merged = new Map<string, { before: string; after: string; truncated: boolean }>();
	for (const item of items) {
		for (const part of item.parts) {
			if (part.type !== "tool" || part.call.diff === null) continue;
			const diff = part.call.diff;
			const seen = merged.get(diff.path);
			if (seen === undefined) {
				merged.set(diff.path, { before: diff.before, after: diff.after, truncated: diff.truncated });
				continue;
			}
			seen.after = diff.after;
			seen.truncated ||= diff.truncated;
		}
	}
	const changes: TurnFileChange[] = [];
	for (const [path, file] of merged) {
		let added = 0;
		let deleted = 0;
		for (const line of diffLines(file.before, file.after)) {
			if (line.kind === "add") added += 1;
			else if (line.kind === "remove") deleted += 1;
		}
		changes.push({ path, added, deleted, before: file.before, after: file.after, truncated: file.truncated });
	}
	return changes;
}

/** 整轮的总增减行数，卡片标题用。 */
export function totalCounts(changes: readonly TurnFileChange[]): { added: number; deleted: number } {
	let added = 0;
	let deleted = 0;
	for (const change of changes) {
		added += change.added;
		deleted += change.deleted;
	}
	return { added, deleted };
}
