/**
 * Auto thinking level resolution.
 *
 * When a session's thinking level is "auto", the concrete level for each request
 * is decided by {@link resolveAutoThinkingLevel}: a cheap LLM classifier is used
 * when configured and answers in time, otherwise a deterministic heuristic picks
 * the level from task-complexity signals. "auto" is never sent to providers that
 * do not natively understand it ({@link hasNativeAutoThinking}).
 */

import { clampThinkingLevel } from "./models.ts";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	ImageContent,
	Model,
	ProviderHeaders,
	SimpleStreamOptions,
	TextContent,
	ThinkingLevel,
	TranscriptContext,
	UserMessage,
} from "./types.ts";
import { normalizeContext } from "./utils/transcript.ts";

/** Levels auto resolution may select. "xhigh" and "max" are never chosen automatically. */
export const AUTO_THINKING_LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high"];

/**
 * Task-complexity signals for one request.
 * All fields besides `prompt` are optional; missing fields are treated as
 * "not available" and do not influence the score.
 */
export interface AutoThinkingSignals {
	/** Text of the user's current prompt. */
	prompt: string;
	/** Number of images attached to the current prompt (0 or omit when none). */
	imageCount?: number;
	/** Number of assistant responses already produced in the current turn (tool-loop depth). */
	toolLoopDepth?: number;
	/** Outcome of the most recent assistant response in the current turn. */
	previousOutcome?: "completed" | "error" | "aborted";
	/** Fraction (0..1) of the context window currently in use. */
	contextUsageRatio?: number;
}

/** Configuration for the optional LLM classifier. */
export interface AutoThinkingClassifier {
	/** Cheap model used to classify the task. */
	model: Model<Api>;
	/** Stream function used to call the classifier (session stream function or a runtime). */
	streamFn: (
		model: Model<Api>,
		context: TranscriptContext,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
	apiKey?: string;
	headers?: ProviderHeaders;
	/** Give up on classification after this many milliseconds (default 6000). */
	timeoutMs?: number;
}

/** Input to {@link resolveAutoThinkingLevel}. */
export interface AutoThinkingResolution {
	/** Target model the resolved level will be applied to. */
	model: Model<Api>;
	signals: AutoThinkingSignals;
	/** When present, the classifier is tried first; any failure falls back to the heuristic. */
	classifier?: AutoThinkingClassifier;
	signal?: AbortSignal;
}

/** Result of auto thinking level resolution. */
export interface AutoThinkingResult {
	/** Concrete thinking level to use for the request (clamped to the target model). */
	level: ThinkingLevel;
	/** Which mechanism produced the level. */
	source: "classifier" | "heuristic";
}

/** Score range: 0..4 mapped onto {@link AUTO_THINKING_LEVELS} (4 clamps to "high"). */
export function autoThinkingScore(signals: AutoThinkingSignals): number {
	const prompt = signals.prompt ?? "";
	const hasImages = (signals.imageCount ?? 0) > 0;
	// Baseline: short prompts lean low, everything else medium.
	let score = prompt.trim().length < 80 ? 1 : 2;
	if (COMPLEX_PROMPT_PATTERN.test(prompt)) score += 1;
	if (SIMPLE_PROMPT_PATTERN.test(prompt)) score -= 1;
	if (hasImages) score += 1;
	if ((signals.toolLoopDepth ?? 0) >= 3) score += 1;
	if (signals.previousOutcome === "error") score += 1;
	if ((signals.contextUsageRatio ?? 0) > 0.85) score += 1;
	return Math.max(0, Math.min(4, score));
}

/** Deterministic fallback: picks a level from the complexity signals. */
export function resolveAutoThinkingLevelHeuristic(model: Model<Api>, signals: AutoThinkingSignals): ThinkingLevel {
	// Score 4 maps to the top level: the array holds minimal..high.
	const level = AUTO_THINKING_LEVELS[Math.min(autoThinkingScore(signals), AUTO_THINKING_LEVELS.length - 1)];
	return clampThinkingLevel(model, level) as ThinkingLevel;
}

const COMPLEX_PROMPT_PATTERN =
	/\b(root cause|why|debug|refactor|refactoring|architect\w*|design|review|security|vulnerab\w*|deadlock|race condition|infinite loop|benchmark|performance|profil\w*|optimi[sz]\w*|investigat\w*|analy[sz]e|migrat\w*|regression|flaky test)\b/i;
const SIMPLE_PROMPT_PATTERN =
	/^\s*(rename|typo|fix (a |the )?typo|format|prettify|add (a |the )?comment|remove (a |the )?line|convert|bump|delete (the )?file)\b|\bone[- ]?liner\b|\bquick(ly)?\b/i;

// Keep this short: the classifier runs on every user turn, so prompt tokens are
// a per-turn cost. ~60 tokens; the user message carries only the task itself.
const CLASSIFIER_SYSTEM_PROMPT =
	"Reply with exactly one word: the reasoning effort this coding task needs. minimal=trivial (renames, typos, simple lookups); low=small self-contained change or simple question; medium=typical coding task; high=debugging, refactoring, architecture, multi-step investigation.";

/**
 * Ask the classifier model for a thinking level. Returns undefined when the
 * classifier is unavailable, times out, or answers with something unparsable.
 */
export async function classifyThinkingLevel(
	classifier: AutoThinkingClassifier,
	signals: AutoThinkingSignals,
	signal?: AbortSignal,
): Promise<ThinkingLevel | undefined> {
	try {
		const timeout = AbortSignal.timeout(classifier.timeoutMs ?? 6000);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const context = normalizeContext({
			systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
			messages: [
				{ role: "user", content: buildClassifierPrompt(signals), timestamp: Date.now() } satisfies UserMessage,
			],
		});
		const stream = await classifier.streamFn(classifier.model, context, {
			temperature: 0,
			maxTokens: 16,
			// No reasoning: reasoning models would spend the token budget on
			// thinking blocks and produce no parsable answer text.
			reasoning: undefined,
			signal: combined,
			apiKey: classifier.apiKey,
			headers: classifier.headers,
		} satisfies SimpleStreamOptions);
		// Race against the timeout so slow streams cannot stall the main request,
		// even if the stream implementation does not honor the abort signal.
		const message = await Promise.race<AssistantMessage | undefined>([
			stream.result(),
			new Promise<undefined>((resolve) =>
				timeout.addEventListener("abort", () => resolve(undefined), { once: true }),
			),
		]);
		if (!message) {
			if (process.env.PI_DEBUG_AUTO_THINKING) console.error("[auto-thinking] classifier: timeout");
			return undefined;
		}
		if (message.stopReason !== "stop" && message.stopReason !== "length") return undefined;
		const text = message.content
			.filter((part): part is TextContent => part.type === "text")
			.map((part) => part.text)
			.join("")
			.trim()
			.toLowerCase()
			.replace(/[^a-z]/g, "");
		if (process.env.PI_DEBUG_AUTO_THINKING) console.error(`[auto-thinking] classifier answer raw="${text}"`);
		return (AUTO_THINKING_LEVELS as readonly string[]).includes(text) ? (text as ThinkingLevel) : undefined;
	} catch (error) {
		if (process.env.PI_DEBUG_AUTO_THINKING)
			console.error(`[auto-thinking] classifier error: ${(error as Error).message ?? String(error)}`);
		return undefined;
	}
}

function buildClassifierPrompt(signals: AutoThinkingSignals): (TextContent | ImageContent)[] {
	const parts: (TextContent | ImageContent)[] = [
		{
			type: "text",
			text: signals.prompt ?? "",
		},
	];
	const imageCount = signals.imageCount ?? 0;
	if (imageCount > 0) {
		parts.push({ type: "text", text: `attached images: ${imageCount}` });
	}
	return parts;
}

/**
 * Resolve the "auto" thinking level for a request: classifier first (when
 * configured), heuristic fallback. The returned level is always clamped to
 * what the target model supports.
 */
export async function resolveAutoThinkingLevel(resolution: AutoThinkingResolution): Promise<AutoThinkingResult> {
	const { model, signals, classifier, signal } = resolution;
	if (classifier) {
		const classified = await classifyThinkingLevel(classifier, signals, signal);
		if (classified) {
			return { level: clampThinkingLevel(model, classified) as ThinkingLevel, source: "classifier" };
		}
	}
	return { level: resolveAutoThinkingLevelHeuristic(model, signals), source: "heuristic" };
}
