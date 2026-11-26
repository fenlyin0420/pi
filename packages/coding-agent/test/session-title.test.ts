import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, type Model } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import {
	generateSessionTitle,
	MAX_SESSION_TITLE_LENGTH,
	type SessionTitleGenerator,
	sanitizeSessionTitle,
} from "../src/core/session-title.ts";

// SAFETY: the stub stream function ignores the model, so any object with a model id is enough.
const MODEL = { id: "title-model", provider: "test" } as Model<"test">;

function streamOf(result: () => Promise<ReturnType<typeof fauxAssistantMessage>>): AssistantMessageEventStream {
	// SAFETY: generateSessionTitle only awaits `result()`, which is the whole stub surface.
	return { result } as unknown as AssistantMessageEventStream;
}

function generator(message: ReturnType<typeof fauxAssistantMessage>, timeoutMs?: number): SessionTitleGenerator {
	return {
		model: MODEL,
		streamFn: () => streamOf(async () => message),
		...(timeoutMs === undefined ? {} : { timeoutMs }),
	};
}

describe("sanitizeSessionTitle", () => {
	it("keeps a plain title as is", () => {
		expect(sanitizeSessionTitle("Fix the session title bug")).toBe("Fix the session title bug");
	});

	it("removes quotes, markdown emphasis, and trailing punctuation", () => {
		expect(sanitizeSessionTitle('  "Fix the session title bug."  ')).toBe("Fix the session title bug");
		expect(sanitizeSessionTitle("**修复会话标题**")).toBe("修复会话标题");
		expect(sanitizeSessionTitle("`tidy up keybindings`")).toBe("tidy up keybindings");
	});

	it("drops a title label the model added despite the instruction", () => {
		expect(sanitizeSessionTitle("Title: Fix the session title bug")).toBe("Fix the session title bug");
		expect(sanitizeSessionTitle("标题：修复会话标题")).toBe("修复会话标题");
	});

	it("keeps only the first non-empty line", () => {
		expect(sanitizeSessionTitle("\n\nFix the session title bug.\nHope this helps!")).toBe(
			"Fix the session title bug",
		);
	});

	it("returns undefined for answers that cannot be a title", () => {
		expect(sanitizeSessionTitle("")).toBeUndefined();
		expect(sanitizeSessionTitle("  \n\t ")).toBeUndefined();
		expect(sanitizeSessionTitle('"  "')).toBeUndefined();
		expect(sanitizeSessionTitle("Title:")).toBeUndefined();
	});

	it("cuts long answers to the title limit", () => {
		const title = sanitizeSessionTitle("a".repeat(MAX_SESSION_TITLE_LENGTH + 20));
		expect(title).toHaveLength(MAX_SESSION_TITLE_LENGTH);
		expect(title?.endsWith("…")).toBe(true);
	});
});

describe("generateSessionTitle", () => {
	it("returns the model's sanitized answer", async () => {
		await expect(
			generateSessionTitle(generator(fauxAssistantMessage('"Fix the session title bug."')), "fix titles"),
		).resolves.toBe("Fix the session title bug");
	});

	it("returns undefined for an empty user message without calling the model", async () => {
		let called = false;
		const generatorWithSpy: SessionTitleGenerator = {
			model: MODEL,
			streamFn: () => {
				called = true;
				return streamOf(async () => fauxAssistantMessage("Fix the session title bug"));
			},
		};
		await expect(generateSessionTitle(generatorWithSpy, "   \n ")).resolves.toBeUndefined();
		expect(called).toBe(false);
	});

	it("returns undefined when the call fails", async () => {
		await expect(
			generateSessionTitle(generator(fauxAssistantMessage("x", { stopReason: "error" })), "fix titles"),
		).resolves.toBeUndefined();
		await expect(
			generateSessionTitle(
				{
					model: MODEL,
					streamFn: () => {
						throw new Error("no network");
					},
				},
				"fix titles",
			),
		).resolves.toBeUndefined();
	});

	it("gives up after the timeout", async () => {
		const hanging: SessionTitleGenerator = {
			model: MODEL,
			streamFn: () => streamOf(() => new Promise(() => {})),
			timeoutMs: 10,
		};
		await expect(generateSessionTitle(hanging, "fix titles")).resolves.toBeUndefined();
	});
});
