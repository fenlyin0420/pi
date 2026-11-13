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

/** 带行号的 diff 行：删除行只属于旧文件，新增行只属于新文件，未变的行两边都有。 */
export type NumberedDiffLine = {
	kind: DiffKind;
	text: string;
	oldNumber: number | null;
	newNumber: number | null;
};

/** 给逐行 diff 补上行号：旧文件从 1 数、新文件从 1 数，各走各的。 */
export function numberDiff(lines: readonly DiffLine[]): NumberedDiffLine[] {
	let oldNumber = 0;
	let newNumber = 0;
	return lines.map((line) => {
		if (line.kind !== "add") oldNumber += 1;
		if (line.kind !== "remove") newNumber += 1;
		return {
			kind: line.kind,
			text: line.text,
			oldNumber: line.kind === "add" ? null : oldNumber,
			newNumber: line.kind === "remove" ? null : newNumber,
		};
	});
}

/** 左右对比的一行：左边是旧文件的一行，右边是新文件的一行，两边都可能为空。 */
export type SplitDiffRow = { left: NumberedDiffLine | null; right: NumberedDiffLine | null };

/**
 * 把单列 diff 折成左右两列：未变的行两边是同一份内容；一段「删完再增」按顺序配对，
 * 多出来的一边留空——删 2 行加 1 行占两行，第一行左旧右新，第二行只有左边。
 */
export function splitDiff(lines: readonly NumberedDiffLine[]): SplitDiffRow[] {
	const rows: SplitDiffRow[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (line === undefined) break;
		if (line.kind === "same") {
			rows.push({ left: line, right: line });
			index += 1;
			continue;
		}
		const removed: NumberedDiffLine[] = [];
		const added: NumberedDiffLine[] = [];
		while (index < lines.length && lines[index]?.kind === "remove") removed.push(lines[index++] as NumberedDiffLine);
		while (index < lines.length && lines[index]?.kind === "add") added.push(lines[index++] as NumberedDiffLine);
		for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) {
			rows.push({ left: removed[pair] ?? null, right: added[pair] ?? null });
		}
	}
	return rows;
}
