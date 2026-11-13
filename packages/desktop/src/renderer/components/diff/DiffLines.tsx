// 面板里的 diff 正文：统一单列视图与左右对比视图，行号顶格、按最宽补零成固定列，
// 每行按文件语言上色，语言没就绪时退回纯文本。

import type { ReactNode } from "react";
import type { NumberedDiffLine, SplitDiffRow } from "../../lib/diff.ts";
import { type HighlightedCode, type HighlightToken, tokenStyle } from "../../lib/highlight.ts";
import { cx } from "../../ui.tsx";

/** 左侧（旧文件）还是右侧（新文件）：决定取哪一列的行号与着色。 */
type Side = "old" | "new";

/** 一份 diff 的着色来源：旧文件与新文件各自的高亮行，未就绪时都是 null。 */
export type DiffColoring = { before: HighlightedCode | null; after: HighlightedCode | null };

/** 单列视图：一行一个行号，删除行显示旧文件行号，其余显示新文件行号。 */
export function UnifiedDiff({ lines, coloring }: { lines: readonly NumberedDiffLine[]; coloring: DiffColoring }) {
	const width = numberWidth(lines);
	return (
		<div className="diff-body unified">
			{lines.map((line, index) => {
				const side: Side = line.kind === "remove" ? "old" : "new";
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: diff 行的顺序就是它的身份
						key={index}
						className={cx("diff-line", line.kind)}
					>
						<span className="diff-line-number">{numberText(numberAt(line, side), width)}</span>
						<span className="diff-line-text">
							<LineText tokens={tokensAt(line, side, coloring)} text={line.text} />
						</span>
					</div>
				);
			})}
		</div>
	);
}

/** 左右对比：旧文件一列、新文件一列，未变的行两边同一份内容，空位留白。 */
export function SplitDiff({ rows, coloring }: { rows: readonly SplitDiffRow[]; coloring: DiffColoring }) {
	const width = numberWidth(rows.flatMap((row) => [row.left, row.right]));
	return (
		<div className="diff-body split">
			{rows.map((row, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: 行顺序就是它的身份
				<div key={index} className="diff-split-row">
					<SplitCell line={row.left} side="old" width={width} coloring={coloring} />
					<SplitCell line={row.right} side="new" width={width} coloring={coloring} />
				</div>
			))}
		</div>
	);
}

/** 一边的格子：没有这一行时只留空行号，底色按这一行的种类（新增/删除/未变）。 */
function SplitCell({
	line,
	side,
	width,
	coloring,
}: {
	line: NumberedDiffLine | null;
	side: Side;
	width: number;
	coloring: DiffColoring;
}) {
	return (
		<div className={cx("diff-split-cell", line === null ? "empty" : line.kind)}>
			<span className="diff-line-number">{numberText(line === null ? null : numberAt(line, side), width)}</span>
			<span className="diff-line-text">
				<LineText tokens={line === null ? null : tokensAt(line, side, coloring)} text={line?.text ?? ""} />
			</span>
		</div>
	);
}

/** 一行的正文：有着色就按 token 拼，没有就原样输出，空行留一个空格撑住行高。 */
function LineText({ tokens, text }: { tokens: readonly HighlightToken[] | null; text: string }) {
	if (!tokens || tokens.length === 0) return <>{text || " "}</>;
	const nodes: ReactNode[] = [];
	// key 用这一行里的字符偏移：同一行里不会重复，也不用数组下标。
	let offset = 0;
	for (const token of tokens) {
		nodes.push(
			<span key={offset} style={tokenStyle(token)}>
				{token.content}
			</span>,
		);
		offset += token.content.length || 1;
	}
	return <>{nodes}</>;
}

/** 这一行在它所属文件里的行号：删除行属于旧文件，其余属于新文件。 */
function numberAt(line: NumberedDiffLine, side: Side): number | null {
	return side === "old" ? line.oldNumber : line.newNumber;
}

/** 这一行在对应文件里的着色 token；行号越界（行数对不上）时退回纯文本。 */
function tokensAt(line: NumberedDiffLine, side: Side, coloring: DiffColoring): readonly HighlightToken[] | null {
	const source = side === "old" ? coloring.before : coloring.after;
	const number = numberAt(line, side);
	if (!source || number === null) return null;
	return source[number - 1] ?? null;
}

/** 行号列宽：按这一份 diff 里最大的行号定，至少两位，读数不跳宽。 */
function numberWidth(lines: readonly (NumberedDiffLine | null)[]): number {
	let width = 2;
	for (const line of lines) {
		for (const number of [line?.oldNumber, line?.newNumber]) {
			if (number !== null && number !== undefined) width = Math.max(width, String(number).length);
		}
	}
	return width;
}

/** 行号按最宽补零成固定列；没有这一行时留同样宽的空位。 */
function numberText(number: number | null, width: number): string {
	return number === null ? " ".repeat(width) : String(number).padStart(width, "0");
}
