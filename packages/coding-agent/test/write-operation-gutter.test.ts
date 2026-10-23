import { resetCapabilitiesCache, setCapabilities, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
	} as unknown as TUI;
}

function createToolDefinition(): ToolDefinition {
	return {
		name: "custom_tool",
		label: "custom_tool",
		description: "custom tool",
		parameters: Type.Any(),
		execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
	};
}

function render(component: ToolExecutionComponent, width = 60): string[] {
	return component.render(width).map((line) => stripAnsi(line));
}

function createComponent(outputPad = 1): ToolExecutionComponent {
	const component = new ToolExecutionComponent(
		"custom_tool",
		"call-1",
		{},
		{ outputPad },
		createToolDefinition(),
		createFakeTui(),
		process.cwd(),
	);
	component.updateResult({ content: [{ type: "text", text: "ok" }], isError: false });
	return component;
}

describe("write operation gutter", () => {
	beforeAll(() => {
		initTheme("dark");
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
	});
	afterAll(() => {
		resetCapabilitiesCache();
	});

	test("marks every row line with a bar on the left edge", () => {
		const component = createComponent();
		const before = render(component);
		expect(before.some((line) => line.startsWith("│"))).toBe(false);

		component.setWriteOperation(true);
		const after = render(component);

		// Every line of the row carries the bar, including the blank lines around its content.
		expect(after.every((line) => line.startsWith("│"))).toBe(true);
		// The bar takes the row's existing left padding, so no line moves or changes width.
		const contentWidthsBefore = before.filter((line) => line.length > 0).map((line) => visibleWidth(line));
		const contentWidthsAfter = after
			.filter((_line, index) => before[index]!.length > 0)
			.map((line) => visibleWidth(line));
		expect(contentWidthsAfter).toEqual(contentWidthsBefore);
	});

	test("keeps the row width when there is no left padding to reuse", () => {
		const component = createComponent(0);
		component.setWriteOperation(true);
		const lines = render(component, 40).filter((line) => line.length > 0);
		expect(lines.every((line) => line.startsWith("│"))).toBe(true);
		expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
	});
	test("drops the bar when the verdict is cleared", () => {
		const component = createComponent();
		component.setWriteOperation(true);
		component.setWriteOperation(false);
		expect(render(component).some((line) => line.startsWith("│"))).toBe(false);
	});
});
