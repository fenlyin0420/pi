// diff 的行号与左右对比折行：行号各走各的，删除/新增按顺序配对。

import { describe, expect, it } from "vitest";
import { diffLines, numberDiff, splitDiff } from "../src/renderer/lib/diff.ts";

describe("numberDiff", () => {
	it("numbers the old and new file independently", () => {
		// before: a b c / after: a x c —— b 换成 x，两端未变。
		const lines = numberDiff(diffLines("a\nb\nc", "a\nx\nc"));
		expect(lines.map((line) => [line.kind, line.oldNumber, line.newNumber])).toEqual([
			["same", 1, 1],
			["remove", 2, null],
			["add", null, 2],
			["same", 3, 3],
		]);
	});

	it("starts both files at one when one side is empty", () => {
		const lines = numberDiff(diffLines("", "x\ny"));
		expect(lines.map((line) => [line.kind, line.newNumber])).toEqual([
			["add", 1],
			["add", 2],
		]);
	});
});

describe("splitDiff", () => {
	it("pairs removals with additions and pads the shorter side", () => {
		// 删两行、加一行：第一行左旧右新，第二行只剩左边。
		const rows = splitDiff(numberDiff(diffLines("a\nb\nc", "a\nz")));
		expect(rows.map((row) => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
			["a", "a"],
			["b", "z"],
			["c", null],
		]);
	});

	it("keeps unchanged lines identical on both sides", () => {
		const rows = splitDiff(numberDiff(diffLines("keep", "keep")));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.left).toBe(rows[0]?.right);
	});
});
