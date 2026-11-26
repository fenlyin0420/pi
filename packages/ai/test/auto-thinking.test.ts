import { describe, expect, it } from "vitest";
import {
	type AutoThinkingClassifier,
	classifyThinkingLevel,
	resolveAutoThinkingLevel,
	resolveAutoThinkingLevelHeuristic,
} from "../src/auto-thinking.ts";
import { clampThinkingLevel, hasNativeAutoThinking, isThinkingLevelEmbeddedInPrompt } from "../src/models.ts";
import type { AssistantMessage, AssistantMessageEventStream, Model } from "../src/types.ts";

function makeModel(overrides: Partial<Model<"openai-completions">> = {}): Model<"openai-completions"> {
	return {
		id: "test-model",
		name: "Test Model",
		api: "openai-completions",
		provider: "test",
		baseUrl: "https://example.com/v1",
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		reasoning: true,
		contextWindow: 128000,
		maxTokens: 4096,
		...overrides,
	};
}

/** Fake stream whose result() resolves to a single text answer. */
function makeTextStream(text: string | undefined, options: { stopReason?: AssistantMessage["stopReason"] } = {}) {
	const message: AssistantMessage = {
		role: "assistant",
		content: text !== undefined ? [{ type: "text", text }] : [],
		api: "openai-completions",
		provider: "test",
		model: "test-model",
		stopReason: options.stopReason ?? "stop",
		errorMessage: undefined,
		timestamp: 0,
		usage: {
			input: 1,
			output: 1,
			reasoning: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
	return { result: async () => message } as unknown as AssistantMessageEventStream;
}

function makeClassifier(
	text: string | undefined,
	overrides: Partial<AutoThinkingClassifier> = {},
): AutoThinkingClassifier {
	return {
		model: makeModel({ id: "classifier-model" }),
		streamFn: () => makeTextStream(text),
		timeoutMs: 50,
		...overrides,
	};
}

describe("thinking level auto support", () => {
	it("falls back to medium for models without native auto support", () => {
		expect(clampThinkingLevel(makeModel(), "auto")).toBe("medium");
	});

	it("keeps auto for models with a native mapping", () => {
		const model = makeModel({ thinkingLevelMap: { auto: "auto" } });
		expect(hasNativeAutoThinking(model)).toBe(true);
		expect(clampThinkingLevel(model, "auto")).toBe("auto");
	});

	it("clamps auto to off for non-reasoning models", () => {
		expect(clampThinkingLevel(makeModel({ reasoning: false }), "auto")).toBe("off");
	});
});

describe("isThinkingLevelEmbeddedInPrompt", () => {
	it("detects chat-template kwargs bound to thinking.effort", () => {
		const model = makeModel({
			compat: {
				chatTemplateKwargs: {
					enable_thinking: { $var: "thinking.enabled" },
					preserve_thinking: true,
					reasoning_effort: { $var: "thinking.effort" },
				},
			},
		});
		expect(isThinkingLevelEmbeddedInPrompt(model)).toBe(true);
	});

	it("detects baseten chat-template args bound to thinking.effort", () => {
		const model = makeModel({
			compat: { chatTemplateArgs: { effort: { $var: "thinking.effort" } } },
		});
		expect(isThinkingLevelEmbeddedInPrompt(model)).toBe(true);
	});

	it("ignores kwargs that never change with the level", () => {
		const model = makeModel({
			compat: {
				chatTemplateKwargs: {
					enable_thinking: { $var: "thinking.enabled" },
					budget: { $var: "thinking.budget" },
					preserve_thinking: true,
				},
			},
		});
		expect(isThinkingLevelEmbeddedInPrompt(model)).toBe(false);
	});

	it("returns false without compat or with wire-parameter thinking formats", () => {
		expect(isThinkingLevelEmbeddedInPrompt(makeModel())).toBe(false);
		const wireParam = makeModel({ compat: { supportsReasoningEffort: true } });
		expect(isThinkingLevelEmbeddedInPrompt(wireParam)).toBe(false);
	});
});

describe("auto thinking heuristic", () => {
	const model = makeModel();

	it("picks low for short plain prompts", () => {
		expect(resolveAutoThinkingLevelHeuristic(model, { prompt: "hi" })).toBe("low");
	});

	it("picks medium for typical prompts", () => {
		expect(
			resolveAutoThinkingLevelHeuristic(model, {
				prompt: "Please implement the login form for the dashboard page, including validation and error handling",
			}),
		).toBe("medium");
	});

	it("picks high for complex prompts", () => {
		expect(
			resolveAutoThinkingLevelHeuristic(model, {
				prompt: "Please review the authentication flow and refactor it so that session expiry is handled properly",
			}),
		).toBe("high");
	});

	it("bumps the level when images are attached", () => {
		const prompt = "Update the button styling";
		expect(resolveAutoThinkingLevelHeuristic(model, { prompt })).toBe("low");
		expect(resolveAutoThinkingLevelHeuristic(model, { prompt, imageCount: 2 })).toBe("medium");
	});

	it("bumps the level on errors and deep tool loops", () => {
		const prompt = "Continue with the migration task from the previous conversation steps";
		const baseline = resolveAutoThinkingLevelHeuristic(model, { prompt });
		const afterFailures = resolveAutoThinkingLevelHeuristic(model, {
			prompt,
			previousOutcome: "error",
			toolLoopDepth: 4,
		});
		expect(baseline).toBe("medium");
		expect(afterFailures).toBe("high");
	});

	it("respects model support", () => {
		const limited = makeModel({ thinkingLevelMap: { high: null, xhigh: null, max: null } });
		expect(
			resolveAutoThinkingLevelHeuristic(limited, { prompt: "Refactor the whole module and write a design doc" }),
		).not.toBe("high");
	});
});

describe("auto thinking classifier", () => {
	it("parses a valid classifier answer", async () => {
		await expect(classifyThinkingLevel(makeClassifier("High"), { prompt: "anything" })).resolves.toBe("high");
	});

	it("does not parse a full sentence containing the level word", async () => {
		await expect(
			classifyThinkingLevel(makeClassifier("The answer is medium."), { prompt: "anything" }),
		).resolves.toBeUndefined();
	});

	it("returns undefined for unparsable answers", async () => {
		await expect(
			classifyThinkingLevel(makeClassifier("I think it is fairly complex"), { prompt: "anything" }),
		).resolves.toBeUndefined();
	});

	it("returns undefined when the classifier call throws", async () => {
		const classifier = makeClassifier(undefined, {
			streamFn: () => {
				throw new Error("no auth");
			},
		});
		await expect(classifyThinkingLevel(classifier, { prompt: "anything" })).resolves.toBeUndefined();
	});

	it("returns undefined when the classifier fails with an error stop reason", async () => {
		const classifier = makeClassifier("high", {
			streamFn: () => makeTextStream("error", { stopReason: "error" }),
		});
		await expect(classifyThinkingLevel(classifier, { prompt: "anything" })).resolves.toBeUndefined();
	});

	it("returns undefined when the classifier times out", async () => {
		const classifier = makeClassifier(undefined, {
			streamFn: () =>
				({
					result: () => new Promise<AssistantMessage>(() => undefined),
				}) as unknown as AssistantMessageEventStream,
		});
		await expect(classifyThinkingLevel(classifier, { prompt: "anything" })).resolves.toBeUndefined();
	});
});

describe("resolveAutoThinkingLevel", () => {
	it("prefers the classifier", async () => {
		const result = await resolveAutoThinkingLevel({
			model: makeModel(),
			signals: { prompt: "hi" },
			classifier: makeClassifier("high"),
		});
		expect(result).toEqual({ level: "high", source: "classifier" });
	});

	it("clamps classifier output to model support", async () => {
		const model = makeModel({ thinkingLevelMap: { high: null, xhigh: null, max: null } });
		const result = await resolveAutoThinkingLevel({
			model,
			signals: { prompt: "hi" },
			classifier: makeClassifier("high"),
		});
		expect(result.source).toBe("classifier");
		expect(result.level).not.toBe("high");
	});

	it("falls back to the heuristic when the classifier is unavailable", async () => {
		const result = await resolveAutoThinkingLevel({
			model: makeModel(),
			signals: { prompt: "hi" },
			classifier: makeClassifier(undefined, {
				streamFn: () => {
					throw new Error("no auth");
				},
			}),
		});
		expect(result).toEqual({ level: "low", source: "heuristic" });
	});

	it("falls back to the heuristic when the classifier is not configured", async () => {
		const result = await resolveAutoThinkingLevel({ model: makeModel(), signals: { prompt: "hi" } });
		expect(result).toEqual({ level: "low", source: "heuristic" });
	});
});
