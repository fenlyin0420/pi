// 通知取舍与文案的单元测试：开关、前台、打断与正文字数。

import { describe, expect, it } from "vitest";
import { AttentionSet, badgeAsset, noticeBody, shouldNotify } from "../src/main/notify-policy.ts";

const base = {
	kind: "settled" as const,
	enabled: true,
	awayOnly: true,
	aborted: false,
	windowFocused: false,
	sessionActive: false,
};

describe("shouldNotify", () => {
	it("总开关关掉就什么都不弹", () => {
		expect(shouldNotify({ ...base, enabled: false })).toBe(false);
		expect(shouldNotify({ ...base, kind: "ask", enabled: false })).toBe(false);
	});

	it("Esc 打断的那一轮不算跑完，但提问照样提示", () => {
		expect(shouldNotify({ ...base, aborted: true })).toBe(false);
		expect(shouldNotify({ ...base, kind: "ask", aborted: true })).toBe(true);
	});

	it("人在跟前看的就是这一条：不打扰", () => {
		expect(shouldNotify({ ...base, windowFocused: true, sessionActive: true })).toBe(false);
	});

	it("前台窗口看的是别的会话，或者窗口根本不在前台：都要提示", () => {
		expect(shouldNotify({ ...base, windowFocused: true, sessionActive: false })).toBe(true);
		expect(shouldNotify({ ...base, windowFocused: false, sessionActive: true })).toBe(true);
	});

	it("关掉“仅不在前台”就每次都提示", () => {
		expect(shouldNotify({ ...base, awayOnly: false, windowFocused: true, sessionActive: true })).toBe(true);
	});
});

describe("badgeAsset", () => {
	it("1–9 用带数字的那张，10 以上用 9+，0 与负数不画", () => {
		expect(badgeAsset(1)).toBe("badge-1");
		expect(badgeAsset(9)).toBe("badge-9");
		expect(badgeAsset(10)).toBe("badge-more");
		expect(badgeAsset(99)).toBe("badge-more");
		expect(badgeAsset(0)).toBeNull();
		expect(badgeAsset(-3)).toBeNull();
		expect(badgeAsset(Number.NaN)).toBeNull();
	});
});

describe("AttentionSet", () => {
	it("按会话去重，看过的摘掉", () => {
		const set = new AttentionSet();
		expect(set.size).toBe(0);
		set.mark("a");
		set.mark("a");
		set.mark("b");
		expect(set.size).toBe(2);
		set.attend("a");
		expect(set.size).toBe(1);
		set.attend(null);
		expect(set.size).toBe(1);
		set.attend("b");
		expect(set.size).toBe(0);
	});

	it("空 id 不计数", () => {
		const set = new AttentionSet();
		set.mark("");
		expect(set.size).toBe(0);
	});
});

describe("noticeBody", () => {
	it("把换行与连续空白折成一行", () => {
		expect(noticeBody("  line one\n\nline   two\t")).toBe("line one line two");
	});

	it("超长按字符截断并加省略号", () => {
		expect(noticeBody("abcdef", 3)).toBe("abc…");
		expect(noticeBody("中文内容", 2)).toBe("中文…");
		expect(noticeBody("abc", 3)).toBe("abc");
	});
});
