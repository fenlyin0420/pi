import { describe, expect, test } from "vitest";
import { resolveModelAlias, resolveModelPair, splitProviderModel } from "../src/core/model-aliases.ts";

describe("resolveModelAlias", () => {
	const aliases = {
		opus: "anthropic/claude-opus-4-8",
		sonnet: "openrouter/anthropic/claude-sonnet-4-5",
		haiku: "local/qwen3.8-27b",
	};

	test("replaces an exact alias with its provider/modelId", () => {
		expect(resolveModelAlias("opus", aliases)).toBe("anthropic/claude-opus-4-8");
	});

	test("keeps the thinking suffix outside the substitution", () => {
		expect(resolveModelAlias("sonnet:high", aliases)).toBe("openrouter/anthropic/claude-sonnet-4-5:high");
	});

	test("passes unknown references through unchanged", () => {
		expect(resolveModelAlias("anthropic/claude-opus-4-8", aliases)).toBe("anthropic/claude-opus-4-8");
		expect(resolveModelAlias("unknown-alias", aliases)).toBe("unknown-alias");
	});

	test("is a no-op without an alias map", () => {
		expect(resolveModelAlias("opus", undefined)).toBe("opus");
	});

	test("does not treat a non-thinking suffix as an alias suffix", () => {
		expect(resolveModelAlias("opus:not-a-level", aliases)).toBe("opus:not-a-level");
	});
});

describe("resolveModelPair", () => {
	const aliases = { opus: "anthropic/claude-opus-4-8", nested: "openrouter/anthropic/claude-opus-5.5" };

	test("an alias replaces both the provider and the model id", () => {
		expect(resolveModelPair("stale-provider", "opus", aliases)).toEqual({
			provider: "anthropic",
			modelId: "claude-opus-4-8",
		});
	});

	test("model ids with slashes survive the split", () => {
		expect(resolveModelPair(undefined, "nested", aliases)).toEqual({
			provider: "openrouter",
			modelId: "anthropic/claude-opus-5.5",
		});
	});

	test("a plain model id keeps the stored provider", () => {
		expect(resolveModelPair("opencode-go", "deepseek-v4.1-flash", aliases)).toEqual({
			provider: "opencode-go",
			modelId: "deepseek-v4.1-flash",
		});
	});

	test("no model id resolves to undefined", () => {
		expect(resolveModelPair("opencode-go", undefined, aliases)).toBeUndefined();
	});
});

describe("splitProviderModel", () => {
	test("splits on the first slash", () => {
		expect(splitProviderModel("a/b/c")).toEqual({ provider: "a", modelId: "b/c" });
	});

	test("rejects specs without both halves", () => {
		expect(splitProviderModel("alias-only")).toBeUndefined();
		expect(splitProviderModel("/leading")).toBeUndefined();
		expect(splitProviderModel("trailing/")).toBeUndefined();
	});
});
