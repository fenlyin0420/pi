import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/** Startup level: "auto" lets the session pick the concrete level per request. */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "auto";
export const THINKING_LEVEL_OPTIONS: readonly ThinkingLevel[] = [
	"off",
	"auto",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];
