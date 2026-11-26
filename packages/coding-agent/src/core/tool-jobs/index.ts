/** Supervised tool execution: suspending calls that outlive their deadline into background jobs. */

export { assessProgress, formatDuration, type OutputActivity, type ProgressCheck } from "./evidence.ts";
export { createJobToolDefinition } from "./job-tool.ts";
export { type ProcessFacts, probeProcessTree } from "./probe.ts";
export { superviseTool, unwrapSupervisedTool } from "./supervise-tool.ts";
export {
	DEFAULT_TOOL_SUPERVISION_LIMITS,
	type JobKillReason,
	jobSettledNotice,
	type SupervisedJob,
	type ToolSupervisionLimits,
	ToolSupervisor,
	type ToolSupervisorOptions,
} from "./supervisor.ts";
