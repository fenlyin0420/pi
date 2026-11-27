import { fauxAssistantMessage, fauxToolCall, type ImageContent } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

// A gateway in front of an OpenAI-compatible provider caps the raw request body at 48 MiB and
// reports that cap as a 400 invalid_request_error. The status is 400, not 413, so the request-size
// rule never matched: pi retried the same oversized request three times and gave up without
// compacting, which left the session unable to send any prompt at all.
const GATEWAY_BODY_CAP_400 =
	'400: {"param":null,"type":"invalid_request_error","code":"invalid_request_error","message":"Upstream request failed: [invalid_request_error] decoded body exceeds 50331648 bytes (request_id: gw-ede9672ddf8c-33635dd)"}';
const REQUEST_LIMIT = 32 * 1024 * 1024;
const RECENT_PROMPT = "Continue the task using the recent notes.";

function seedImageHistory(harness: Harness, imageData: string): void {
	const timestamp = Date.now() - 10_000;
	const model = harness.getModel();
	harness.sessionManager.appendMessage({ role: "user", content: "Review the old images", timestamp });
	harness.sessionManager.appendMessage({
		...fauxAssistantMessage(fauxToolCall("read", { path: "old-images" }, { id: "read-images" }), {
			stopReason: "toolUse",
			timestamp,
		}),
		provider: model.provider,
		api: model.api,
		model: model.id,
	});
	harness.sessionManager.appendMessage({
		role: "toolResult",
		toolCallId: "read-images",
		toolName: "read",
		content: Array.from(
			{ length: 89 },
			(): ImageContent => ({
				type: "image",
				mimeType: "image/png",
				data: imageData,
			}),
		),
		isError: false,
		timestamp,
	});
	harness.sessionManager.appendMessage({
		...fauxAssistantMessage("Finished reviewing the old images", { timestamp }),
		provider: model.provider,
		api: model.api,
		model: model.id,
	});
	// Keep a completed recent turn so recovery does not summarize the entire current request when it
	// omits the failed assistant attempt. The old images are outside the default 20k-token retained tail.
	harness.sessionManager.appendMessage({
		role: "user",
		content: `Recent task notes: ${"x".repeat(80_000)}`,
		timestamp,
	});
	harness.sessionManager.appendMessage({
		...fauxAssistantMessage("Ready to continue", { timestamp }),
		provider: model.provider,
		api: model.api,
		model: model.id,
	});
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

describe("gateway request-size overflow recovery", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("compacts an image-heavy history and retries after a 400 body-cap error", async () => {
		const harness = await createHarness({
			provider: "opencode-go",
			models: [{ id: "faux-gateway", contextWindow: 1_000_000 }],
		});
		harnesses.push(harness);
		// Synthetic base64 only; no image decoding or network calls are involved.
		seedImageHistory(harness, "A".repeat(384 * 1024));
		harness.setResponses([
			(context) => {
				expect(Buffer.byteLength(JSON.stringify(context))).toBeGreaterThan(REQUEST_LIMIT);
				throw new Error(GATEWAY_BODY_CAP_400);
			},
			// The overflow recovery summarization runs on the compacted, image-free context.
			() => fauxAssistantMessage("The old images have been reviewed. Continue with the recent task."),
			(context) => {
				// The retried request no longer carries the images, so it stays under the byte limit.
				expect(JSON.stringify(context)).not.toContain('"type":"image"');
				return fauxAssistantMessage("Continued after compaction");
			},
		]);

		await harness.session.prompt(RECENT_PROMPT);

		expect(harness.faux.state.callCount).toBe(3);
		expect(harness.eventsOfType("compaction_start")).toEqual([{ type: "compaction_start", reason: "overflow" }]);
		expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
			reason: "overflow",
			aborted: false,
			willRetry: true,
		});
		// The session continued to a final answer instead of dying on the 400.
		expect(harness.session.getLastAssistantText()).toBe("Continued after compaction");
	});
});
