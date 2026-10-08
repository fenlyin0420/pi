import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { setKeybindings, type TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { KeybindingsManager } from "../../../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../../../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";
import { createModelRegistry, getModelRuntime } from "../../model-runtime-test-utils.ts";

function observeRefreshRender(): { tui: TUI; renderedAfterRefresh: Promise<void> } {
	let renderCount = 0;
	let resolveRefreshRender = () => {};
	const renderedAfterRefresh = new Promise<void>((resolve) => {
		resolveRefreshRender = resolve;
	});
	return {
		tui: {
			requestRender: () => {
				renderCount++;
				if (renderCount === 2) resolveRefreshRender();
			},
		} as unknown as TUI,
		renderedAfterRefresh,
	};
}

function modelsJson(provider: string, model: string, name: string): Record<string, unknown> {
	return {
		providers: {
			[provider]: {
				baseUrl: "https://example.test/v1",
				api: "openai-completions",
				apiKey: "test-key",
				models: [{ id: model, name }],
			},
		},
	};
}

/** Minimal scope entry; the component re-resolves the real model from the runtime. */
function scopedEntry(provider: string, id: string): { model: Model<string> } {
	return { model: { provider, id, name: id } as unknown as Model<string> };
}

describe("issue #6999 models.json hot reload", () => {
	let tempDir: string | undefined;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	});

	it("reloads models.json when opening /model", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-models-json-hot-reload-"));
		const modelsPath = join(tempDir, "models.json");
		writeFileSync(modelsPath, JSON.stringify(modelsJson("reload-provider", "reload-model", "Old Name")));
		const modelRuntime = getModelRuntime(await createModelRegistry(AuthStorage.inMemory(), modelsPath));
		expect(modelRuntime.getModel("reload-provider", "reload-model")).toBeDefined();

		writeFileSync(modelsPath, JSON.stringify(modelsJson("reload-provider", "reload-model", "New Name")));
		const { tui, renderedAfterRefresh } = observeRefreshRender();
		const selector = new ModelSelectorComponent(
			tui,
			undefined,
			modelRuntime,
			[scopedEntry("reload-provider", "reload-model")],
			() => {},
			() => {},
		);

		await renderedAfterRefresh;
		const rendered = stripAnsi(selector.render(120).join("\n"));
		expect(rendered).toContain("New Name [reload-provider]");
		expect(rendered).not.toContain("Old Name");
	});
});
