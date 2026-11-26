// 定位条点亮哪一格的换算测试：滚动比例，以及比例落在第几格。

import { describe, expect, it } from "vitest";
import { scrollFraction, stepIndex } from "../src/renderer/lib/scroll-rail.ts";

describe("scrollFraction", () => {
	it("贴顶是 0，滚到底是 1", () => {
		expect(scrollFraction(0, 4000, 800)).toBe(0);
		expect(scrollFraction(3200, 4000, 800)).toBe(1);
	});

	it("中间按可滚距离取比例", () => {
		expect(scrollFraction(1600, 4000, 800)).toBeCloseTo(0.5);
	});

	it("内容不足一屏时没有位置可言", () => {
		expect(scrollFraction(0, 300, 800)).toBe(0);
		expect(scrollFraction(120, 800, 800)).toBe(0);
	});

	it("越界的滚动值夹在两端", () => {
		expect(scrollFraction(-40, 4000, 800)).toBe(0);
		expect(scrollFraction(9999, 4000, 800)).toBe(1);
	});
});

describe("stepIndex", () => {
	it("比例均分成格子：0 是首格，1 是末格", () => {
		expect(stepIndex(0, 4)).toBe(0);
		expect(stepIndex(1, 4)).toBe(3);
	});

	it("比例落在哪一格就取哪一格，不落在格子之间", () => {
		expect(stepIndex(0.24, 4)).toBe(0);
		expect(stepIndex(0.26, 4)).toBe(1);
		expect(stepIndex(0.5, 4)).toBe(2);
	});

	it("越界的比例夹在两端", () => {
		expect(stepIndex(-0.5, 4)).toBe(0);
		expect(stepIndex(9, 4)).toBe(3);
	});

	it("一格都没有时返回 -1", () => {
		expect(stepIndex(0.5, 0)).toBe(-1);
	});
});
