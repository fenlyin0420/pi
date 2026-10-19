import { Container, setKeybindings, setVimModeEnabled, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultEditorTheme } from "../../tui/test/test-themes.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function createEditor(interrupts: { count: number }): CustomEditor {
	const keybindings = new KeybindingsManager();
	setKeybindings(keybindings);
	const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, keybindings);
	editor.onEscape = () => {
		interrupts.count++;
	};
	return editor;
}

afterEach(() => {
	setVimModeEnabled(false);
	setKeybindings(new KeybindingsManager());
});

describe("CustomEditor escape in vim mode", () => {
	it("interrupts the active operation instead of switching vim mode", () => {
		setVimModeEnabled(true);
		const interrupts = { count: 0 };
		const editor = createEditor(interrupts);
		editor.hasEscapeInterruptTarget = () => true;

		editor.handleInput("\x1b"); // Escape

		expect(interrupts.count).toBe(1);
		expect(editor.getText()).toBe("");
	});

	it("keeps Escape for vim mode when nothing is interruptible", () => {
		setVimModeEnabled(true);
		const interrupts = { count: 0 };
		const editor = createEditor(interrupts);
		editor.hasEscapeInterruptTarget = () => false;
		editor.setText("draft");

		editor.handleInput("\x1b"); // Escape

		expect(interrupts.count).toBe(0);
		expect(editor.getText()).toBe("draft");
	});

	it("keeps the plain interrupt handler when vim mode is off", () => {
		const interrupts = { count: 0 };
		const editor = createEditor(interrupts);
		editor.hasEscapeInterruptTarget = () => false;

		editor.handleInput("\x1b"); // Escape

		expect(interrupts.count).toBe(1);
	});
});

type EscapeInterruptContext = {
	defaultEditor: {
		onEscape?: () => void;
		hasEscapeInterruptTarget?: () => boolean;
		onAction: () => void;
	};
	editor: { getText(): string; setText(text: string): void };
	session: {
		isStreaming: boolean;
		isBashRunning: boolean;
		getSteeringMessages(): readonly string[];
		getFollowUpMessages(): readonly string[];
		abortBash: () => void;
	};
	ui: { onDebug: () => void; requestRender: () => void };
	settingsManager: { getDoubleEscapeAction(): string };
	pendingMessagesContainer: Container;
	compactionQueuedMessages: { text: string; mode: "steer" | "followUp" }[];
	lastEscapeTime: number;
	lastInterruptEscapeTime: number;
	interruptEscapeHintVisible: boolean;
	interruptEscapeHintTimer: ReturnType<typeof setTimeout> | undefined;
	updateEditorBorderColor: () => void;
	restoreQueuedMessagesToEditor: (options?: { abort?: boolean }) => void;
	getAppKeyDisplay: (action: string) => string;
	confirmInterruptEscape: (interrupt: () => void) => void;
	showInterruptEscapeHint: () => void;
	clearInterruptEscapeHint: () => void;
	updatePendingMessagesDisplay: () => void;
	getAllQueuedMessages: () => { steering: string[]; followUp: string[] };
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as {
	setupKeyHandlers(this: EscapeInterruptContext): void;
	confirmInterruptEscape(this: EscapeInterruptContext, interrupt: () => void): void;
	showInterruptEscapeHint(this: EscapeInterruptContext): void;
	clearInterruptEscapeHint(this: EscapeInterruptContext): void;
	updatePendingMessagesDisplay(this: EscapeInterruptContext): void;
	getAllQueuedMessages(this: EscapeInterruptContext): { steering: string[]; followUp: string[] };
};

function createEscapeContext(): EscapeInterruptContext {
	initTheme("dark");
	const context = {
		defaultEditor: { onAction: () => {} },
		editor: { getText: () => "", setText: () => {} },
		session: {
			isStreaming: false,
			isBashRunning: false,
			getSteeringMessages: () => [],
			getFollowUpMessages: () => [],
			abortBash: vi.fn(),
		},
		ui: { onDebug: () => {}, requestRender: () => {} },
		settingsManager: { getDoubleEscapeAction: () => "none" },
		pendingMessagesContainer: new Container(),
		compactionQueuedMessages: [],
		lastEscapeTime: 0,
		lastInterruptEscapeTime: 0,
		interruptEscapeHintVisible: false,
		interruptEscapeHintTimer: undefined,
		updateEditorBorderColor: () => {},
		restoreQueuedMessagesToEditor: vi.fn(),
		getAppKeyDisplay: () => "Esc",
	} as unknown as EscapeInterruptContext;
	context.confirmInterruptEscape = (interrupt) =>
		interactiveModePrototype.confirmInterruptEscape.call(context, interrupt);
	context.showInterruptEscapeHint = () => interactiveModePrototype.showInterruptEscapeHint.call(context);
	context.clearInterruptEscapeHint = () => interactiveModePrototype.clearInterruptEscapeHint.call(context);
	context.updatePendingMessagesDisplay = () => interactiveModePrototype.updatePendingMessagesDisplay.call(context);
	context.getAllQueuedMessages = () => interactiveModePrototype.getAllQueuedMessages.call(context);
	return context;
}

function pendingHintLines(context: EscapeInterruptContext): string {
	return stripAnsi(context.pendingMessagesContainer.render(120).join("\n"));
}

describe("InteractiveMode escape interrupt", () => {
	it("reports an interrupt target while streaming, running bash, or while an escape handler is installed", () => {
		const context = createEscapeContext();
		interactiveModePrototype.setupKeyHandlers.call(context);
		const hasTarget = () => context.defaultEditor.hasEscapeInterruptTarget?.() ?? false;

		expect(hasTarget()).toBe(false);

		context.session.isStreaming = true;
		expect(hasTarget()).toBe(true);
		context.session.isStreaming = false;

		context.session.isBashRunning = true;
		expect(hasTarget()).toBe(true);
		context.session.isBashRunning = false;

		// Retry, compaction and branch summarization swap in their own handler.
		context.defaultEditor.onEscape = () => {};
		expect(hasTarget()).toBe(true);
	});

	it("asks for a second escape before interrupting a streaming run", () => {
		const context = createEscapeContext();
		interactiveModePrototype.setupKeyHandlers.call(context);
		context.session.isStreaming = true;

		context.defaultEditor.onEscape?.();

		expect(context.restoreQueuedMessagesToEditor).not.toHaveBeenCalled();
		expect(pendingHintLines(context)).toContain("Press Esc again to stop");

		context.defaultEditor.onEscape?.();

		expect(context.restoreQueuedMessagesToEditor).toHaveBeenCalledWith({ abort: true });
		expect(pendingHintLines(context)).not.toContain("Press Esc again to stop");
		context.clearInterruptEscapeHint();
	});

	it("asks again when the confirm window has passed", () => {
		const context = createEscapeContext();
		interactiveModePrototype.setupKeyHandlers.call(context);
		context.session.isStreaming = true;

		context.defaultEditor.onEscape?.();
		context.lastInterruptEscapeTime = 0; // the window expired and cleared the timestamp

		context.defaultEditor.onEscape?.();

		expect(context.restoreQueuedMessagesToEditor).not.toHaveBeenCalled();
		expect(pendingHintLines(context)).toContain("Press Esc again to stop");
		context.clearInterruptEscapeHint();
	});

	it("confirms bash aborts the same way", () => {
		const context = createEscapeContext();
		interactiveModePrototype.setupKeyHandlers.call(context);
		context.session.isBashRunning = true;

		context.defaultEditor.onEscape?.();
		expect(context.session.abortBash).not.toHaveBeenCalled();

		context.defaultEditor.onEscape?.();
		expect(context.session.abortBash).toHaveBeenCalledTimes(1);
		context.clearInterruptEscapeHint();
	});
});
