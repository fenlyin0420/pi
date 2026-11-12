import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const skipOnWindows = process.platform === "win32" ? it.skip : it;

describe("session tool supervision", () => {
	let harness: Harness;

	afterEach(() => {
		harness?.cleanup();
	});

	skipOnWindows(
		"hands a suspended bash call back as a job the model decides on",
		async () => {
			harness = await createHarness({
				settings: { toolSupervision: { softDeadlineMs: 50 } },
				initialActiveToolNames: ["bash"],
			});
			// The decision surface is active without being listed: a suspension without it has no way out.
			expect(harness.session.getActiveToolNames()).not.toContain("job");

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 0.4; echo done" }), { stopReason: "toolUse" }),
				fauxAssistantMessage(
					fauxToolCall("job", { action: "wait", id: "j1", timeout: 10, reason: "no output yet" }),
					{
						stopReason: "toolUse",
					},
				),
				fauxAssistantMessage("finished"),
			]);

			await harness.session.prompt("run it");

			const toolResults = harness.session.messages.filter((message) => message.role === "toolResult");
			expect(toolResults).toHaveLength(2);
			expect(harness.session.getActiveToolNames()).toContain("job");
			const suspended = getMessageText(toolResults[0]);
			expect(suspended).toContain("was suspended as job j1");
			expect(suspended).toContain("Assessment:");
			expect(getMessageText(toolResults[1])).toContain("done");
		},
		30_000,
	);

	skipOnWindows(
		"stops a suspended command when the model kills it",
		async () => {
			harness = await createHarness({
				settings: { toolSupervision: { softDeadlineMs: 50 } },
				initialActiveToolNames: ["bash"],
			});

			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("bash", { command: "sleep 30" }), { stopReason: "toolUse" }),
				fauxAssistantMessage(fauxToolCall("job", { action: "kill", id: "j1", reason: "no output, no CPU" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("finished"),
			]);

			await harness.session.prompt("run it");

			const toolResults = harness.session.messages.filter((message) => message.role === "toolResult");
			expect(getMessageText(toolResults[0])).toContain("was suspended as job j1");
			expect(getMessageText(toolResults[1])).toContain("Stopped at your request");
		},
		30_000,
	);
});
