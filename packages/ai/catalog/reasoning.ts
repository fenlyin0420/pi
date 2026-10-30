import type { ThinkingLevel, ThinkingLevelMap } from "../src/types.ts";
import type { ModelsDevReasoningOption } from "./sources/models-dev.ts";

// models.dev never reports "auto" (this fork's extra ThinkingLevel), so the map skips it.
const THINKING_LEVELS = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const satisfies readonly ThinkingLevel[];

/**
 * Converts models.dev verified effort values into Pi's selectable thinking levels.
 * Values without a Pi equivalent (`default` and JSON `null`) are intentionally
 * omitted.
 */
export function getEffortThinkingLevelMap(options: readonly ModelsDevReasoningOption[]): ThinkingLevelMap | undefined {
	const effortValues = options.flatMap((option) => (option.type === "effort" ? option.values : []));
	if (effortValues.length === 0) return undefined;

	const supported = new Set(effortValues);
	if (!THINKING_LEVELS.some((level) => supported.has(level)) && !supported.has("none")) return undefined;

	const map: ThinkingLevelMap = { off: supported.has("none") ? "none" : null };
	for (const level of THINKING_LEVELS) {
		map[level] = supported.has(level) ? level : null;
	}
	return map;
}
