// 编辑工具的 diff 行：按字面逐行前缀对照，不做完整 LCS。

export type DiffKind = "same" | "add" | "remove";

/** 一行 diff：kind 决定颜色和符号，text 是不含符号的原文。 */
export type DiffLine = { kind: DiffKind; text: string };

/** 由 before/after 两段文本生成 +/- 行，前面共同的部分标成 same。 */
export function diffLines(before: string, after: string): DiffLine[] {
	const beforeLines = splitLines(before);
	const afterLines = splitLines(after);
	// 先对齐两端相同的行，中间剩下的整段视为“删掉旧的、加上新的”。
	const prefix = commonPrefix(beforeLines, afterLines);
	const suffix = commonSuffix(beforeLines, afterLines, prefix);
	const lines: DiffLine[] = [];
	for (const text of beforeLines.slice(0, prefix)) lines.push({ kind: "same", text });
	for (const text of beforeLines.slice(prefix, beforeLines.length - suffix)) lines.push({ kind: "remove", text });
	for (const text of afterLines.slice(prefix, afterLines.length - suffix)) lines.push({ kind: "add", text });
	for (const text of afterLines.slice(afterLines.length - suffix)) lines.push({ kind: "same", text });
	return lines;
}

function splitLines(text: string): string[] {
	if (text === "") return [];
	return text.replace(/\n$/, "").split("\n");
}

function commonPrefix(before: readonly string[], after: readonly string[]): number {
	const limit = Math.min(before.length, after.length);
	let index = 0;
	while (index < limit && before[index] === after[index]) index += 1;
	return index;
}

function commonSuffix(before: readonly string[], after: readonly string[], prefix: number): number {
	const limit = Math.min(before.length, after.length) - prefix;
	let count = 0;
	while (count < limit && before[before.length - 1 - count] === after[after.length - 1 - count]) count += 1;
	return count;
}
