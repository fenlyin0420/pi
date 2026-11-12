import { type FauxResponseFactory, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, type Harness } from "./harness.ts";

/**
 * A new session is titled from its first user message by the model the settings map `haiku` to.
 * The title is the session name, which the TUI (terminal title, footer, picker) and the desktop
 * sidebar both read, so the test asserts the name and the `session_info_changed` event instead of
 * either surface.
 */

const harnesses: Harness[] = [];

afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
});

/** Answers a title request with `title` and every other request with `reply`. */
function scripted(title: string | undefined, counts: { title: number; models: string[] }): FauxResponseFactory {
	return (context, _options, _state, model) => {
		// normalizeContext folds the system prompt into the leading message.
		const system = context.messages[0]?.role === "system" ? contentTextOf(context.messages[0]) : "";
		if (system.includes("Name the coding session")) {
			counts.title++;
			counts.models.push(model.id);
			return fauxAssistantMessage(title ?? "Title:");
		}
		return fauxAssistantMessage("done");
	};
}

function contentTextOf(message: { content: unknown }): string {
	return typeof message.content === "string" ? message.content : "";
}

const ALIAS_SETTINGS = { modelAliases: { haiku: "faux/title-model" } };

describe("session title generation", () => {
	it("names a new session from the first user message with the haiku alias model", async () => {
		const counts = { title: 0, models: [] as string[] };
		const step = scripted('"Fix the session title bug."', counts);
		const harness = await createHarness({
			models: [{ id: "main" }, { id: "title-model" }],
			settings: ALIAS_SETTINGS,
		});
		harnesses.push(harness);
		harness.setResponses([step, step, step, step]);

		await harness.session.prompt("在 coding-agent 里用 haiku 给会话自动生成标题");
		await vi.waitFor(() => expect(harness.sessionManager.getSessionName()).toBe("Fix the session title bug"));

		expect(counts.models).toEqual(["title-model"]);
		expect(harness.eventsOfType("session_info_changed").at(-1)?.name).toBe("Fix the session title bug");
	});

	it("keeps a name the user set and does not call the model", async () => {
		const counts = { title: 0, models: [] as string[] };
		const step = scripted("Generated title", counts);
		const harness = await createHarness({ settings: ALIAS_SETTINGS });
		harnesses.push(harness);
		const titleCall = vi.fn(step);
		harness.setResponses([titleCall, titleCall]);

		harness.session.setSessionName("Mine");
		await harness.session.prompt("hi");

		expect(counts.title).toBe(0);
		expect(harness.sessionManager.getSessionName()).toBe("Mine");
	});

	it("leaves the first message as the display name when no haiku alias resolves", async () => {
		const counts = { title: 0, models: [] as string[] };
		const step = scripted("Generated title", counts);
		const harness = await createHarness({});
		harnesses.push(harness);
		harness.setResponses([step, step]);

		await harness.session.prompt("hi");

		expect(counts.title).toBe(0);
		expect(harness.sessionManager.getSessionName()).toBeUndefined();
	});

	it("titles once: a later message does not replace the title", async () => {
		const counts = { title: 0, models: [] as string[] };
		const first = scripted("First title", counts);
		const second = scripted("Second title", counts);
		const harness = await createHarness({
			models: [{ id: "main" }, { id: "title-model" }],
			settings: ALIAS_SETTINGS,
		});
		harnesses.push(harness);
		harness.setResponses([first, first]);

		await harness.session.prompt("hi");
		await vi.waitFor(() => expect(harness.sessionManager.getSessionName()).toBe("First title"));

		harness.appendResponses([second, second]);
		await harness.session.prompt("again");

		expect(counts.title).toBe(1);
		expect(harness.sessionManager.getSessionName()).toBe("First title");
	});

	it("does not title a session that already has messages", async () => {
		const counts = { title: 0, models: [] as string[] };
		const step = scripted("Generated title", counts);
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "earlier message" }],
			timestamp: Date.now(),
		});
		const harness = await createHarness({ sessionManager, settings: ALIAS_SETTINGS });
		harnesses.push(harness);
		harness.setResponses([step, step]);

		await harness.session.prompt("continue");

		expect(counts.title).toBe(0);
		expect(harness.sessionManager.getSessionName()).toBeUndefined();
	});
});
