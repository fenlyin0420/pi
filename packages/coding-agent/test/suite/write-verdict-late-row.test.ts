import type { TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.ts";
import { ToolExecutionComponent } from "../../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";

const TOOL_CALL_ID = "call-late-verdict";

type HandleEvent = (this: VerdictContextThis, event: AgentSessionEvent) => Promise<void>;

type VerdictContextThis = {
	isInitialized: boolean;
	footer: { invalidate(): void };
	programStatus: { handleEvent(): void };
	ui: TUI;
	pendingTools: Map<string, ToolExecutionComponent>;
	toolRows: Map<string, ToolExecutionComponent>;
	session: { getWriteVerdict(toolCallId: string): { write: boolean } | undefined };
};

function createFakeTui(): TUI {
	return { requestRender: vi.fn() } as unknown as TUI;
}

function createContext(): VerdictContextThis {
	return {
		isInitialized: true,
		footer: { invalidate: vi.fn() },
		programStatus: { handleEvent: vi.fn() },
		ui: createFakeTui(),
		pendingTools: new Map<string, ToolExecutionComponent>(),
		toolRows: new Map<string, ToolExecutionComponent>(),
		session: { getWriteVerdict: () => undefined },
	};
}

function createRow(): ToolExecutionComponent {
	const component = new ToolExecutionComponent(
		"bash",
		TOOL_CALL_ID,
		{ command: "touch out.txt" },
		{ outputPad: 1 },
		undefined,
		createFakeTui(),
		process.cwd(),
	);
	component.updateResult({ content: [{ type: "text", text: "ok" }], isError: false });
	return component;
}

function hasBar(component: ToolExecutionComponent): boolean {
	return component.render(60).some((line) => stripAnsi(line).startsWith("│"));
}

describe("late write verdicts", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	// A model-decided verdict lands after a fast tool already finished, so the row is no longer pending.
	test("marks a finished row whose verdict arrives after tool_execution_end", async () => {
		const context = createContext();
		const row = createRow();
		context.toolRows.set(TOOL_CALL_ID, row);
		const handleEvent = (InteractiveMode.prototype as unknown as { handleEvent: HandleEvent }).handleEvent;

		expect(hasBar(row)).toBe(false);

		await handleEvent.call(context, {
			type: "tool_write_verdict",
			toolCallId: TOOL_CALL_ID,
			write: true,
			source: "classifier",
		});

		expect(hasBar(row)).toBe(true);
	});

	test("ignores a verdict for a row that is not on screen", async () => {
		const context = createContext();
		const handleEvent = (InteractiveMode.prototype as unknown as { handleEvent: HandleEvent }).handleEvent;

		await expect(
			handleEvent.call(context, {
				type: "tool_write_verdict",
				toolCallId: "call-unknown",
				write: true,
				source: "classifier",
			}),
		).resolves.toBeUndefined();
	});
});
