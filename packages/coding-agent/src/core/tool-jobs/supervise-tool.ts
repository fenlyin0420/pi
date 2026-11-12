/**
 * Wraps a tool so the supervisor can suspend it into a background job instead of blocking the agent
 * loop until it finishes.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolSupervisor } from "./supervisor.ts";

const supervisedTools = new WeakMap<AgentTool<any>, AgentTool<any>>();

/**
 * Wrap `tool` for `supervisor`. Returns the tool unchanged when there is no supervisor or the tool
 * declares `suspendable: false`.
 */
export function superviseTool(tool: AgentTool<any>, supervisor: ToolSupervisor | undefined): AgentTool<any> {
	if (!supervisor || tool.supervision?.suspendable === false) return tool;
	const supervised: AgentTool<any> = {
		...tool,
		execute: (toolCallId, params, signal, onUpdate) => supervisor.run(tool, params, toolCallId, signal, onUpdate),
	};
	supervisedTools.set(supervised, tool);
	return supervised;
}

/**
 * The tool a supervised wrapper runs, or the tool itself. Programmatic callers such as codemode
 * scripts have no model to ask, so they run the unsuspended tool.
 */
export function unwrapSupervisedTool(tool: AgentTool<any>): AgentTool<any> {
	return supervisedTools.get(tool) ?? tool;
}
