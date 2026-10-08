import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, type Model, type ThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

/**
 * Auto thinking must not churn the concrete level inside a user turn, and on
 * models whose thinking level is rendered into the prompt text (chat-template
 * kwargs bound to `thinking.effort`) it must stay pinned for the session: a
 * level change there rewrites the prompt prefix and invalidates the provider's
 * KV cache.
 */

const harnesses: Harness[] = [];

afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
});

const COMPLEX_PROMPT =
	"Investigate and fix the race condition in the order processing module; analyze the deadlock root cause";

/** Scripted response step that records the resolved thinking level of the request. */
function captureStep(levels: (ThinkingLevel | undefined)[]) {
	return (_context: unknown, options: { reasoning?: ThinkingLevel } | undefined) => {
		levels.push(options?.reasoning);
		return fauxAssistantMessage("ok");
	};
}

function echoTool(): AgentTool {
	return {
		name: "echo",
		label: "Echo",
		description: "Echo text back",
		parameters: Type.Object({ text: Type.String() }),
		execute: async (_toolCallId, params) => {
			const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
			return {
				content: [{ type: "text", text: `echo:${text}` }],
				details: { text },
			};
		},
	};
}

const REASONING_MODEL = { id: "faux-1", name: "One", reasoning: true };

describe("AgentSession auto thinking level stability", () => {
	it("keeps a stable level across tool-loop iterations within one user turn", async () => {
		const levels: (ThinkingLevel | undefined)[] = [];
		const toolStep = (_context: unknown, options: { reasoning?: ThinkingLevel } | undefined) => {
			levels.push(options?.reasoning);
			return fauxAssistantMessage(fauxToolCall("echo", { text: "x" }), { stopReason: "toolUse" });
		};
		const harness = await createHarness({ models: [REASONING_MODEL], tools: [echoTool()] });
		harnesses.push(harness);
		harness.setResponses([toolStep, toolStep, toolStep, toolStep, toolStep, fauxAssistantMessage("done")]);
		harness.session.setThinkingLevel("auto");

		// Long plain prompt resolves to "medium"; the tool loop reaches depth 4,
		// which must not escalate the level mid-turn.
		await harness.session.prompt(
			"Please summarize the project documentation sections that mention configuration, build steps, and deployment settings",
		);

		expect(levels).toEqual(["medium", "medium", "medium", "medium", "medium"]);
	});

	it("re-resolves the level per user turn when the level is a wire parameter", async () => {
		const levels: (ThinkingLevel | undefined)[] = [];
		const harness = await createHarness({ models: [REASONING_MODEL] });
		harnesses.push(harness);
		harness.setResponses([captureStep(levels)]);
		harness.session.setThinkingLevel("auto");

		await harness.session.prompt("hi");
		harness.setResponses([captureStep(levels)]);
		await harness.session.prompt(COMPLEX_PROMPT);

		expect(levels).toEqual(["low", "high"]);
	});

	it("pins the resolved level for the session when the level is embedded in the prompt", async () => {
		const levels: (ThinkingLevel | undefined)[] = [];
		const harness = await createHarness({ models: [REASONING_MODEL] });
		harnesses.push(harness);
		const model = harness.getModel();
		// SAFETY: the faux model is a plain runtime Model object; the cast only
		// exposes the compat field so this test can declare prompt-embedded thinking.
		(model as unknown as Model<"openai-completions">).compat = {
			thinkingFormat: "chat-template",
			chatTemplateKwargs: {
				enable_thinking: { $var: "thinking.enabled" },
				preserve_thinking: true,
				reasoning_effort: { $var: "thinking.effort" },
			},
		};
		harness.setResponses([captureStep(levels)]);
		harness.session.setThinkingLevel("auto");

		await harness.session.prompt("hi");
		harness.setResponses([captureStep(levels)]);
		await harness.session.prompt(COMPLEX_PROMPT);

		// The second turn would resolve to "high" standalone; the pinned level wins.
		expect(levels).toEqual(["low", "low"]);
	});
});
