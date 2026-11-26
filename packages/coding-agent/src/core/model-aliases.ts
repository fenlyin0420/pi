/**
 * Model aliases: short, provider-free names ("opus", "sonnet", "haiku") that
 * settings.json maps to a concrete "provider/modelId".
 *
 * The alias map is resolved wherever Pi parses a user-authored model
 * reference — CLI flags, settings defaults, `/model`, classifier settings and
 * extension callers — so swapping the underlying model is a one-line settings
 * change instead of an edit to every place that names a model.
 */

import { isValidThinkingLevel } from "../cli/args.ts";

/** Alias map from settings.json `modelAliases`. */
export type ModelAliases = Record<string, string>;

/** A resolved provider/model pair. */
export interface ResolvedModelPair {
	provider: string;
	modelId: string;
}

/**
 * Resolve a model reference ("opus", "opus:high", "provider/modelId") through
 * the alias map. Unknown references pass through untouched, and a thinking
 * suffix stays outside the substitution: "opus:high" → "<target>:high".
 */
export function resolveModelAlias(reference: string, aliases: ModelAliases | undefined): string {
	if (!aliases) return reference;
	const trimmed = reference.trim();
	const direct = aliases[trimmed];
	if (direct) return direct;

	const colon = trimmed.lastIndexOf(":");
	if (colon > 0 && isValidThinkingLevel(trimmed.slice(colon + 1))) {
		const alias = aliases[trimmed.slice(0, colon)];
		if (alias) return `${alias}:${trimmed.slice(colon + 1)}`;
	}
	return reference;
}

/**
 * Resolve a stored provider/model pair. An alias replaces both halves; a
 * plain model id keeps the stored provider. Undefined when there is no model.
 */
export function resolveModelPair(
	provider: string | undefined,
	modelId: string | undefined,
	aliases: ModelAliases | undefined,
): ResolvedModelPair | undefined {
	if (!modelId) return undefined;
	const target = aliases?.[modelId];
	if (target) return splitProviderModel(target);
	return provider ? { provider, modelId } : undefined;
}

/** Split "provider/modelId" on the first slash; model ids may contain slashes. */
export function splitProviderModel(spec: string): ResolvedModelPair | undefined {
	const slash = spec.indexOf("/");
	if (slash <= 0 || slash === spec.length - 1) return undefined;
	return { provider: spec.slice(0, slash), modelId: spec.slice(slash + 1) };
}
