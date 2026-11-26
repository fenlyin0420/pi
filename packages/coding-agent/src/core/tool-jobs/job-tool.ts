/**
 * The `job` tool: the decision surface for a tool call that the supervisor suspended past its
 * deadline, so the model waits, stops, or reads it based on the reported evidence.
 */

import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { ToolSupervisor } from "./supervisor.ts";

const jobSchema = Type.Object({
	action: Type.Union([Type.Literal("wait"), Type.Literal("kill"), Type.Literal("output")], {
		description:
			"wait keeps waiting for the suspended call, kill stops it, output reads what it wrote so far. Output does not stop the call.",
	}),
	id: Type.String({ description: 'Job id from the suspended tool result, for example "j1".' }),
	timeout: Type.Optional(Type.Number({ description: "Seconds to wait for action=wait. Default 120, maximum 600." })),
	reason: Type.Optional(
		Type.String({
			description:
				"Why this action, citing the evidence of the suspended result (output and CPU movement). Required for wait and kill.",
		}),
	),
});

const GUIDELINES = [
	'A tool result that says the call "was suspended as job jN" describes a call that is still running, not a failure. Decide from its evidence: keep waiting, stop it, or continue other work and read the result later.',
	"Wait only while the evidence shows progress: output or CPU time moving since the last check. When it shows no output and no CPU movement, stop the job and re-run the command with the cause removed (a lock held elsewhere, a prompt that reads stdin, an unbounded search).",
	"A shell call's `timeout` is the duration you expect it to take: past it the command keeps running and comes back as a job instead of being killed.",
	"Write long output to a file instead of piping it into `tail`: a buffering pipeline reports nothing until the command ends, which hides whether the command is still working.",
	"Put the measurement you acted on in `reason`.",
] as const;

/** Create the `job` tool over `supervisor`. */
export function createJobToolDefinition(supervisor: ToolSupervisor): ToolDefinition<typeof jobSchema> {
	return {
		name: "job",
		label: "job",
		description:
			"Act on a tool call that was suspended because it ran longer than its deadline. The call keeps running in the background until you kill it or its wall-clock limit stops it. Job ids come from the suspended tool results.",
		promptSnippet: "Wait for, stop, or read a tool call suspended past its deadline",
		promptGuidelines: [...GUIDELINES],
		parameters: jobSchema,
		supervision: { suspendable: false },
		async execute(_toolCallId, params) {
			if (params.action !== "output" && !params.reason?.trim()) {
				return {
					content: [
						{
							type: "text",
							text: `job ${params.action} needs \`reason\`: the evidence from the suspended result that made you choose it.`,
						},
					],
					details: {},
					isError: true,
				};
			}
			switch (params.action) {
				case "wait":
					return supervisor.wait(params.id, toMilliseconds(params.timeout), params.reason ?? "");
				case "kill":
					return supervisor.kill(params.id, params.reason ?? "");
				case "output":
					return supervisor.output(params.id);
			}
		},
	};
}

function toMilliseconds(seconds: number | undefined): number | undefined {
	return seconds === undefined ? undefined : Math.max(0, seconds * 1000);
}
