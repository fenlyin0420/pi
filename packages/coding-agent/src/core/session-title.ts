/**
 * Session title generation.
 *
 * A new session is titled from its first user message by the model the settings map the
 * `haiku` alias to. The title is written as the session's `session_info` name, which is what the
 * TUI (terminal title, footer, session picker) and the desktop sidebar already display, so neither
 * surface has its own title code.
 *
 * The call runs next to the first turn instead of inside it: it never delays the answer, and any
 * failure (no alias, no credentials, timeout, unusable answer) leaves the first message as the
 * display name.
 */

import {
	type AssistantMessageEventStream,
	normalizeContext,
	type TextContent,
	type UserMessage,
} from "@earendil-works/pi-ai";
import type {
	Api,
	AssistantMessage,
	Model,
	ProviderHeaders,
	SimpleStreamOptions,
	TranscriptContext,
} from "@earendil-works/pi-ai/compat";

/** Settings alias naming the model that writes titles. */
export const SESSION_TITLE_ALIAS = "haiku";

/** How long a title call may take before it is abandoned. */
export const DEFAULT_SESSION_TITLE_TIMEOUT_MS = 15000;

/** Longest title kept, in characters. */
export const MAX_SESSION_TITLE_LENGTH = 60;

/** First user message is cut to this many characters: enough for a topic, cheap per session. */
const MAX_TITLE_INPUT_LENGTH = 4000;

/** The model call that writes a title. */
export interface SessionTitleGenerator {
	model: Model<Api>;
	streamFn: (
		model: Model<Api>,
		context: TranscriptContext,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
	apiKey?: string;
	headers?: ProviderHeaders;
	/** Session id, for providers that need it to route a request (OpenCode, for example). */
	sessionId?: string;
	/** Give up after this many milliseconds. Default {@link DEFAULT_SESSION_TITLE_TIMEOUT_MS}. */
	timeoutMs?: number;
}

// Titles are read in a narrow list row: a few words carry the topic, and the same
// language as the user keeps them recognizable at a glance.
const TITLE_SYSTEM_PROMPT =
	"Name the coding session that starts with the user's next message. Reply with the name only: 3 to 6 words, in the user's language, no quotes, no markdown, no trailing punctuation. Describe the task, not the greeting.";

/**
 * Turn a model answer into a display title, or undefined when it cannot be one (empty, or only a
 * label such as "Title:"). Quotes, markdown emphasis, a leading label, and trailing punctuation
 * are removed because models add them despite the instruction.
 */
export function sanitizeSessionTitle(raw: string): string | undefined {
	const firstLine = raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	if (!firstLine) return undefined;
	let text = firstLine.replace(/^(?:session\s+)?(?:title|标题)\s*[:：]\s*/i, "");
	text = text.replace(/^["'“”‘’`*_#>\s]+/, "").replace(/["'“”‘’`*_#\s]+$/, "");
	text = text.replace(/[.。!！?？,，;；:：、…\s]+$/g, "");
	if (!text) return undefined;
	return text.length > MAX_SESSION_TITLE_LENGTH ? `${text.slice(0, MAX_SESSION_TITLE_LENGTH - 1).trimEnd()}…` : text;
}

/**
 * Ask the generator model for a title for `userMessage`. Returns undefined when the message has no
 * text, the call fails, times out, or the answer sanitizes to nothing.
 */
export async function generateSessionTitle(
	generator: SessionTitleGenerator,
	userMessage: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	const input = userMessage.trim();
	if (!input) return undefined;
	try {
		const timeout = AbortSignal.timeout(generator.timeoutMs ?? DEFAULT_SESSION_TITLE_TIMEOUT_MS);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const context = normalizeContext({
			systemPrompt: TITLE_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: input.slice(0, MAX_TITLE_INPUT_LENGTH) }],
					timestamp: Date.now(),
				} satisfies UserMessage,
			],
		});
		const stream = await generator.streamFn(generator.model, context, {
			temperature: 0,
			// Some chat models think before answering even with reasoning disabled, so the budget
			// covers a short thinking block on top of a few words.
			maxTokens: 512,
			reasoning: undefined,
			signal: combined,
			apiKey: generator.apiKey,
			headers: generator.headers,
			...(generator.sessionId ? { sessionId: generator.sessionId } : {}),
		} satisfies SimpleStreamOptions);
		// Race the timeout too, so a stream that ignores the signal cannot keep the call pending.
		const message = await Promise.race<AssistantMessage | undefined>([
			stream.result(),
			new Promise<undefined>((resolve) =>
				timeout.addEventListener("abort", () => resolve(undefined), { once: true }),
			),
		]);
		if (!message) return undefined;
		if (message.stopReason !== "stop" && message.stopReason !== "length") return undefined;
		const text = message.content
			.filter((part): part is TextContent => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		return sanitizeSessionTitle(text);
	} catch {
		return undefined;
	}
}
