// 定位条游标的换算测试：滚动比例，以及比例落在刻度列上的哪个高度。

import { describe, expect, it } from "vitest";
import { cursorCenter, scrollFraction } from "../src/renderer/lib/scroll-rail.ts";

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

describe("cursorCenter", () => {
	it("比例 0 压在首格，比例 1 压在末格", () => {
		expect(cursorCenter(100, 200, 0)).toBe(100);
		expect(cursorCenter(100, 200, 1)).toBe(200);
	});

	it("中间比例落在两格之间", () => {
		expect(cursorCenter(100, 200, 0.25)).toBe(125);
	});

	it("两格重合时不跑飞", () => {
		expect(cursorCenter(80, 80, 0.5)).toBe(80);
	});
});
