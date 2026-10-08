import type { Model } from "@earendil-works/pi-ai";
import { setKeybindings, type TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function createFakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

describe("model selector", () => {
	let harness: Harness | undefined;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("keeps the current model marked while browsing", async () => {
		harness = await createHarness({
			models: [
				{ id: "current-model", name: "Current Model", reasoning: true },
				{ id: "browsed-model", name: "Browsed Model", reasoning: true },
			],
		});
		const currentModel = harness.getModel("current-model")!;
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			currentModel,
			harness.session.modelRuntime,
			[{ model: currentModel }, { model: harness.getModel("browsed-model")! }],
			() => {},
			() => {},
		);

		const getModelRow = (name: string): string | undefined =>
			stripAnsi(selector.render(120).join("\n"))
				.split("\n")
				.find((line) => line.includes(`${name} [`))
				?.trimEnd();

		expect(getModelRow("Current Model")).toBe(`→ ✓ Current Model [${currentModel.provider}]`);
		selector.handleInput("\x1b[B");
		expect(getModelRow("Current Model")).toBe(`  ✓ Current Model [${currentModel.provider}]`);
		expect(getModelRow("Browsed Model")).toBe(`→   Browsed Model [${currentModel.provider}]`);
		selector.dispose();
	});

	it("lists display names and keeps the id in the detail line", async () => {
		harness = await createHarness({ models: [{ id: "claude-fable-5", name: "Claude Fable 5" }] });
		const currentModel = harness.getModel("claude-fable-5")!;
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			currentModel,
			harness.session.modelRuntime,
			[{ model: currentModel }],
			() => {},
			() => {},
		);

		const rendered = stripAnsi(selector.render(120).join("\n"));
		expect(rendered).toContain(`Claude Fable 5 [${currentModel.provider}]`);
		expect(rendered).toContain("Model ID: claude-fable-5");
		selector.dispose();
	});

	it("lists only the scoped models, never the rest of the catalog", async () => {
		harness = await createHarness({
			models: [
				{ id: "in-scope", name: "In Scope" },
				{ id: "out-of-scope", name: "Out Of Scope" },
			],
		});
		const inScope = harness.getModel("in-scope")!;
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			inScope,
			harness.session.modelRuntime,
			[{ model: inScope }],
			() => {},
			() => {},
		);

		const rendered = stripAnsi(selector.render(120).join("\n"));
		expect(rendered).toContain("In Scope [");
		expect(rendered).not.toContain("Out Of Scope");
		selector.dispose();
	});

	it("points at enabledModels instead of listing the catalog when the scope is empty", async () => {
		harness = await createHarness({ models: [{ id: "available", name: "Available" }] });
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			harness.getModel("available"),
			harness.session.modelRuntime,
			[],
			() => {},
			() => {},
		);

		const rendered = stripAnsi(selector.render(120).join("\n"));
		expect(rendered).toContain('Set "enabledModels" in settings.json');
		expect(rendered).toContain("No models in scope");
		expect(rendered).not.toContain("Available [");
		selector.dispose();
	});

	it("uses the configured save binding", async () => {
		setKeybindings(new KeybindingsManager({ "app.models.save": "ctrl+r" }));
		harness = await createHarness();
		const currentModel = harness.getModel()!;
		const saveDefault = vi.fn();
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			currentModel,
			harness.session.modelRuntime,
			[{ model: currentModel }],
			() => {},
			() => {},
			undefined,
			saveDefault,
		);

		expect(stripAnsi(selector.render(120).join("\n"))).toContain("Ctrl+R to set as default");
		selector.handleInput("\x13");
		expect(saveDefault).not.toHaveBeenCalled();
		selector.handleInput("\x12");
		expect(saveDefault).toHaveBeenCalledWith(currentModel);
	});

	it("lists every catalog that failed to refresh", async () => {
		harness = await createHarness();
		const currentModel = harness.getModel() as Model<string>;
		vi.spyOn(harness.session.modelRuntime, "refresh").mockResolvedValue({
			aborted: false,
			errors: new Map([
				["openai", new Error("unavailable")],
				["anthropic", new Error("unavailable")],
			]),
		});

		const selector = new ModelSelectorComponent(
			createFakeTui(),
			currentModel,
			harness.session.modelRuntime,
			[{ model: currentModel }],
			() => {},
			() => {},
		);

		await vi.waitFor(() => {
			const rendered = stripAnsi(selector.render(120).join("\n"));
			expect(rendered).toContain("Could not refresh 2 model catalogs (openai, anthropic); showing cached models.");
		});
	});
});
