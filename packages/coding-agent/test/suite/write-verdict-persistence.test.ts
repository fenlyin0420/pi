import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ToolWriteVerdictEvent } from "../../src/core/extensions/types.ts";
import { WRITE_VERDICT_ENTRY_TYPE } from "../../src/core/write-classifier.ts";
import { createHarness, type Harness } from "./harness.ts";

/** A bash stand-in: the verdict comes from the command text, so the tool never runs anything. */
const bashStub: AgentTool = {
	name: "bash",
	label: "bash",
	description: "Run a shell command.",
	parameters: Type.Object({ command: Type.String() }),
	execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
};

function toolCallIdOf(harness: Harness): string {
	for (const message of [...harness.session.messages].reverse()) {
		if (message.role !== "assistant") continue;
		const call = message.content.find((part) => part.type === "toolCall");
		if (call?.type === "toolCall") return call.id;
	}
	throw new Error("no tool call in the transcript");
}

describe("write verdict persistence", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("stores a write verdict as a session entry and hands it to extensions", async () => {
		const seen: ToolWriteVerdictEvent[] = [];
		const extension = (pi: ExtensionAPI): void => {
			pi.on("tool_write_verdict", (event) => {
				seen.push(event);
			});
		};
		const harness = await createHarness({ tools: [bashStub], extensionFactories: [extension] });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "touch out.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("write a file");

		const toolCallId = toolCallIdOf(harness);
		const verdicts = harness.eventsOfType("tool_write_verdict");
		expect(verdicts).toContainEqual({ type: "tool_write_verdict", toolCallId, write: true, source: "command" });
		expect(seen).toContainEqual({ type: "tool_write_verdict", toolCallId, write: true, source: "command" });
		expect(harness.session.getWriteVerdict(toolCallId)).toEqual({ write: true, source: "command" });

		const stored = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom" && entry.customType === WRITE_VERDICT_ENTRY_TYPE);
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({ type: "custom", data: { toolCallId, source: "command" } });
	});

	it("restores the verdict when the session is resumed", async () => {
		const harness = await createHarness({ tools: [bashStub] });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm -rf build" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("remove the build output");
		const toolCallId = toolCallIdOf(harness);

		const resumed = await createHarness({ tools: [bashStub], sessionManager: harness.sessionManager });
		harnesses.push(resumed);

		expect(resumed.session.getWriteVerdict(toolCallId)).toEqual({ write: true, source: "command" });
	});

	it("stores nothing for a read-only call", async () => {
		const harness = await createHarness({ tools: [bashStub] });
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "ls -la" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("list the files");

		const toolCallId = toolCallIdOf(harness);
		expect(harness.session.getWriteVerdict(toolCallId)?.write).toBe(false);
		expect(
			harness.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === WRITE_VERDICT_ENTRY_TYPE),
		).toHaveLength(0);
	});
});
