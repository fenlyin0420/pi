// 展示层格式化与分组规则的单元测试；时间断言全部用固定的 now，不依赖真实时钟。

import { describe, expect, it } from "vitest";
import { diffLines } from "../src/renderer/lib/diff.ts";
import {
	baseName,
	formatBytes,
	formatCost,
	formatDuration,
	formatElapsed,
	formatSessionTime,
	formatTokens,
	lineTail,
	oneLine,
	sessionGroup,
} from "../src/renderer/lib/format.ts";

const NOW = new Date("2026-11-09T12:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("formatTokens", () => {
	it("紧凑显示千级 token", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(987)).toBe("987");
		expect(formatTokens(12_400)).toBe("12.4K");
		expect(formatTokens(1_200_000)).toBe("1.2M");
	});

	it("负数和非数按 0 处理", () => {
		expect(formatTokens(-5)).toBe("0");
		expect(formatTokens(Number.NaN)).toBe("0");
	});
});

describe("oneLine", () => {
	it("折叠空白、去掉首尾空白", () => {
		expect(oneLine("  a\n\tb   c ", 40)).toBe("a b c");
	});

	it("超长才截断，转折号算在上限外", () => {
		expect(oneLine("abcdef", 6)).toBe("abcdef");
		expect(oneLine("abcdefg", 6)).toBe("abcdef…");
	});
});

describe("lineTail", () => {
	it("超长时截掉开头，留下最新那段", () => {
		expect(lineTail("abcdef", 6)).toBe("abcdef");
		expect(lineTail("abcdefg", 6)).toBe("…bcdefg");
	});

	it("同样折叠空白：预览只有一行", () => {
		expect(lineTail("  a\n\tb ", 40)).toBe("a b");
	});
});

describe("formatDuration", () => {
	it("毫秒、秒、分钟三档", () => {
		expect(formatDuration(420)).toBe("420ms");
		expect(formatDuration(3200)).toBe("3.2s");
		expect(formatDuration(64_000)).toBe("1m 4s");
		expect(formatDuration(null)).toBe("");
		expect(formatDuration(0)).toBe("");
	});
});

describe("formatElapsed", () => {
	it("秒级只给秒", () => {
		expect(formatElapsed(0)).toBe("0s");
		expect(formatElapsed(12_400)).toBe("12s");
	});

	it("分钟级给分和补零的秒", () => {
		expect(formatElapsed(65_000)).toBe("1m 05s");
	});

	it("小时级只留整分", () => {
		expect(formatElapsed(3_725_000)).toBe("1h 02m");
	});
});

describe("formatCost", () => {
	it("小额保留四位，常规两位", () => {
		expect(formatCost(0)).toBe("$0");
		expect(formatCost(0.0012)).toBe("$0.0012");
		expect(formatCost(0.42)).toBe("$0.420");
		expect(formatCost(3.456)).toBe("$3.46");
	});
});

describe("sessionGroup", () => {
	it("按今天、昨天、过去 7 天、更早分档", () => {
		expect(sessionGroup(NOW - HOUR, NOW)).toBe("Today");
		expect(sessionGroup(NOW - DAY, NOW)).toBe("Yesterday");
		expect(sessionGroup(NOW - 3 * DAY, NOW)).toBe("Last 7 days");
		expect(sessionGroup(NOW - 30 * DAY, NOW)).toBe("Older");
	});

	it("跨过本地零点就算昨天，而不是按 24 小时算", () => {
		const justAfterMidnight = new Date("2026-11-09T00:30:00").getTime();
		const lateYesterday = new Date("2026-11-08T23:30:00").getTime();
		expect(sessionGroup(lateYesterday, justAfterMidnight)).toBe("Yesterday");
	});
});

describe("formatSessionTime", () => {
	it("今天给时分，昨天给 Yesterday，更早给月日", () => {
		expect(formatSessionTime(NOW - HOUR, NOW)).toMatch(/\d{1,2}:\d{2}/);
		expect(formatSessionTime(NOW - DAY, NOW)).toBe("Yesterday");
		expect(formatSessionTime(NOW - 30 * DAY, NOW)).toMatch(/[A-Za-z]{3} \d{1,2}/);
	});
});

describe("diffLines", () => {
	it("对齐两端共同行，中间先删后加", () => {
		const lines = diffLines("a\nb\nc", "a\nx\nc");
		expect(lines).toEqual([
			{ kind: "same", text: "a" },
			{ kind: "remove", text: "b" },
			{ kind: "add", text: "x" },
			{ kind: "same", text: "c" },
		]);
	});

	it("纯新增把 after 整体标成 add", () => {
		expect(diffLines("", "one\ntwo")).toEqual([
			{ kind: "add", text: "one" },
			{ kind: "add", text: "two" },
		]);
	});

	it("完全相同只有 same，末尾换行不影响结果", () => {
		expect(diffLines("a\nb\n", "a\nb")).toEqual([
			{ kind: "same", text: "a" },
			{ kind: "same", text: "b" },
		]);
	});
});

describe("formatBytes", () => {
	it("字节以内给整数，之后 KB / MB / GB", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(987)).toBe("987 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(12 * 1024 * 1024)).toBe("12 MB");
		expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
	});

	it("负数和非数按 0 处理", () => {
		expect(formatBytes(-1)).toBe("0 B");
		expect(formatBytes(Number.NaN)).toBe("0 B");
	});
});

describe("baseName", () => {
	it("两种分隔符都切在最后一段", () => {
		expect(baseName("/home/u/report.pdf")).toBe("report.pdf");
		expect(baseName("C:\\Users\\u\\notes.txt")).toBe("notes.txt");
	});

	it("没有分隔符时原样返回", () => {
		expect(baseName("file.md")).toBe("file.md");
	});
});
