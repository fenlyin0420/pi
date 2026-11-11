// 展示层格式化与分组规则的单元测试；时间断言全部用固定的 now，不依赖真实时钟。

import { describe, expect, it } from "vitest";
import { diffLines } from "../src/renderer/lib/diff.ts";
import {
	formatCost,
	formatDuration,
	formatSessionTime,
	formatTokens,
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

describe("formatDuration", () => {
	it("毫秒、秒、分钟三档", () => {
		expect(formatDuration(420)).toBe("420ms");
		expect(formatDuration(3200)).toBe("3.2s");
		expect(formatDuration(64_000)).toBe("1m 4s");
		expect(formatDuration(null)).toBe("");
		expect(formatDuration(0)).toBe("");
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
