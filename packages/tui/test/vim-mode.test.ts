import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { SelectList } from "../src/components/select-list.ts";
import { SettingsList, type SettingsListTheme } from "../src/components/settings-list.ts";
import type { TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { matchesVimListNav, setVimModeEnabled } from "../src/vim-mode.ts";
import { defaultEditorTheme, defaultSelectListTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const ESC = "\x1b";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";

function createTestTUI(): TUI {
	return new TuiMainScreen(new VirtualTerminal(80, 24));
}

/**
 * Editor seeded with `text` and the cursor at `target`.
 *
 * Position walking uses the arrow bindings, which behave the same in both modes,
 * and runs before vim mode claims the first keypress (or would, if it were on).
 */
function createVimEditor(text: string, target = { line: 0, col: 0 }): Editor {
	const editor = new Editor(createTestTUI(), defaultEditorTheme);
	editor.focused = true;
	editor.setText(text);

	const cursor = editor.getCursor();
	for (let line = cursor.line; line < target.line; line++) editor.handleInput(DOWN);
	for (let line = cursor.line; line > target.line; line--) editor.handleInput(UP);
	let col = editor.getCursor().col;
	while (col > target.col) {
		editor.handleInput(LEFT);
		col = editor.getCursor().col;
	}
	while (col < target.col) {
		editor.handleInput(RIGHT);
		col = editor.getCursor().col;
	}

	// Vim mode latches on the first keypress. Send an empty one so the mode
	// indicator and isVimEditing() are live even when no walking happened.
	editor.handleInput("");
	return editor;
}

/** Enter normal mode from insert mode. */
function toNormal(editor: Editor): void {
	editor.handleInput(ESC);
}

/** Let the debounced autocomplete request settle. */
async function flushAutocomplete(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setImmediate(resolve));
}

function feed(editor: Editor, ...keys: string[]): void {
	for (const key of keys) editor.handleInput(key);
}

/** Feed a literal string one character at a time, as typing would arrive. */
function type(editor: Editor, text: string): void {
	for (const char of text) editor.handleInput(char);
}

afterEach(() => {
	setVimModeEnabled(false);
});

describe("Editor vim mode", () => {
	describe("mode entry and exit", () => {
		it("starts in insert mode so a prompt can be typed right away", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("");

			assert.strictEqual(editor.isVimEditing(), true);
			type(editor, "hi");

			assert.strictEqual(editor.getText(), "hi");
		});

		it("returns to insert mode after a submit", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("");
			let submitted = "";
			editor.onSubmit = (text) => {
				submitted = text;
			};
			type(editor, "hello");
			toNormal(editor);
			editor.handleInput(ENTER);

			assert.strictEqual(submitted, "hello");
			type(editor, "next");
			assert.strictEqual(editor.getText(), "next");
		});

		it("swallows escape in normal mode instead of inserting", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("");
			toNormal(editor);
			editor.handleInput(ESC);

			assert.strictEqual(editor.getText(), "");
		});
	});

	describe("motions", () => {
		it("moves horizontally without wrapping across lines", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("ab", { line: 0, col: 1 });
			toNormal(editor);

			feed(editor, "l", "h", "h");

			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
		});

		it("stops $ on the last character instead of past it", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("hello");
			toNormal(editor);

			feed(editor, "$");

			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
		});

		it("jumps 0 and ^ to the first non-blank character", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("   hello");
			toNormal(editor);

			feed(editor, "^");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

			feed(editor, "$", "0");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
		});

		it("moves by word with w, e and b", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("alpha beta");
			toNormal(editor);

			feed(editor, "e");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });

			feed(editor, "w");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });

			feed(editor, "b");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
		});

		it("jumps to the first and last line with gg and G", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("one\ntwo\nthree", { line: 1, col: 1 });
			toNormal(editor);

			feed(editor, "G");
			assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 0 });

			feed(editor, "g", "g");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
		});

		it("honours count prefixes", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("abcdefghij");
			toNormal(editor);

			feed(editor, "5", "l");

			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });
		});

		it("treats gg with a count as a goto line", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("one\ntwo\nthree\nfour");
			toNormal(editor);

			feed(editor, "3", "g", "g");

			assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 0 });
		});

		it("treats a leading 0 as a motion, not a count digit", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("0123456789");
			toNormal(editor);

			feed(editor, "0");

			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
		});

		it("jumps to a character with f and stops before it with t", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("a_b_c");
			toNormal(editor);

			feed(editor, "f", "_");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });

			feed(editor, "t", "_");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });
		});

		it("moves vertically with the arrow keys", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("ab\ncd");
			toNormal(editor);

			feed(editor, RIGHT);
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });

			feed(editor, DOWN);
			assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 1 });

			feed(editor, UP);
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });
		});

		it("scrolls the transcript once j runs out of lines", () => {
			setVimModeEnabled(true);
			const scrolled: number[] = [];
			const tui = createTestTUI();
			tui.scrollViewport = (lines) => scrolled.push(lines);
			const editor = new Editor(tui, defaultEditorTheme);
			editor.setText("one\ntwo");
			editor.handleInput("");
			toNormal(editor);
			// setText parks the cursor on the last line, with nothing below it.
			assert.strictEqual(editor.getCursor().line, 1);

			feed(editor, "j");
			assert.deepStrictEqual(scrolled, [1]);
			assert.strictEqual(editor.getCursor().line, 1);

			feed(editor, "k");
			assert.deepStrictEqual(scrolled, [1]);
			assert.strictEqual(editor.getCursor().line, 0);
		});

		it("ignores an unsupported g-command", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("one\ntwo", { line: 1, col: 1 });
			toNormal(editor);

			feed(editor, "g", "t");

			assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 1 });
		});
	});

	describe("insert entry", () => {
		it("inserts before the cursor with i", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("bc");
			toNormal(editor);

			feed(editor, "i");
			type(editor, "a");

			assert.strictEqual(editor.getText(), "abc");
		});

		it("appends after the cursor with a", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("abc");
			toNormal(editor);

			feed(editor, "a");
			type(editor, "X");

			assert.strictEqual(editor.getText(), "aXbc");
		});

		it("appends at the line end with A", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("bc");
			toNormal(editor);

			feed(editor, "A");
			type(editor, "d");

			assert.strictEqual(editor.getText(), "bcd");
		});

		it("opens a line below with o and above with O", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("one\nthree");
			toNormal(editor);

			feed(editor, "o");
			type(editor, "two");
			assert.strictEqual(editor.getText(), "one\ntwo\nthree");

			toNormal(editor);
			feed(editor, "O");
			type(editor, "zero");
			assert.strictEqual(editor.getText(), "one\nzero\ntwo\nthree");
		});
	});

	describe("operators", () => {
		it("deletes a whole line with dd", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("one\ntwo\nthree", { line: 1, col: 1 });
			toNormal(editor);

			feed(editor, "d", "d");

			assert.strictEqual(editor.getText(), "one\nthree");
			assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });
		});

		it("deletes counted lines with 3dd", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("a\nb\nc\nd");
			toNormal(editor);

			feed(editor, "3", "d", "d");

			assert.strictEqual(editor.getText(), "d");
		});

		it("keeps one empty line when dd removes everything", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("only");
			toNormal(editor);

			feed(editor, "d", "d");

			assert.strictEqual(editor.getText(), "");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
		});

		it("deletes the word under the cursor with dw", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("alpha beta");
			toNormal(editor);

			feed(editor, "d", "w");

			assert.strictEqual(editor.getText(), "beta");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
		});

		it("deletes the rest of the last word with dw, like de", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("alpha", { line: 0, col: 2 });
			toNormal(editor);

			feed(editor, "d", "w");

			assert.strictEqual(editor.getText(), "al");
		});

		it("deletes a character before the cursor with dh", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("abc", { line: 0, col: 2 });
			toNormal(editor);

			feed(editor, "d", "h");

			assert.strictEqual(editor.getText(), "ac");
		});

		it("deletes to the end of the line with D", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("keep drop", { line: 0, col: 4 });
			toNormal(editor);

			feed(editor, "D");

			assert.strictEqual(editor.getText(), "keep");
		});

		it("changes to the end of the line with C and lands in insert mode", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("abc def", { line: 0, col: 4 });
			toNormal(editor);

			feed(editor, "C");
			type(editor, "xyz");

			assert.strictEqual(editor.getText(), "abc xyz");
		});

		it("changes the line with cc without joining it to the next", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("old\nkeep", { line: 0, col: 1 });
			toNormal(editor);

			feed(editor, "c", "c");
			type(editor, "new");

			assert.strictEqual(editor.getText(), "new\nkeep");
		});

		it("substitutes the character under the cursor with s", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("abc", { line: 0, col: 1 });
			toNormal(editor);

			feed(editor, "s");
			type(editor, "X");

			assert.strictEqual(editor.getText(), "aXc");
		});

		it("clears the line with S", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("drop\nkeep", { line: 0, col: 2 });
			toNormal(editor);

			feed(editor, "S");
			type(editor, "new");

			assert.strictEqual(editor.getText(), "new\nkeep");
		});

		it("deletes forward with x and backward with X without crossing lines", () => {
			setVimModeEnabled(true);
			const forward = createVimEditor("ab");
			toNormal(forward);
			feed(forward, "2", "x");
			assert.strictEqual(forward.getText(), "");

			const backward = createVimEditor("ab", { line: 0, col: 1 });
			toNormal(backward);
			feed(backward, "3", "X");
			assert.strictEqual(backward.getText(), "b");
		});

		it("yanks with yy and pastes the line below with p", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("one\nthree");
			toNormal(editor);

			feed(editor, "y", "y", "p");

			assert.strictEqual(editor.getText(), "one\none\nthree");
			assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });
		});

		it("pastes the yanked line above with P", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("one\nthree");
			toNormal(editor);

			feed(editor, "y", "y", "P");

			assert.strictEqual(editor.getText(), "one\none\nthree");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
		});

		it("pastes a deleted character inline with P", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("ab", { line: 0, col: 1 });
			toNormal(editor);

			feed(editor, "x", "P");

			assert.strictEqual(editor.getText(), "ba");
		});

		it("replaces the character under the cursor with r", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("abc", { line: 0, col: 1 });
			toNormal(editor);

			feed(editor, "r", "Z");

			assert.strictEqual(editor.getText(), "aZc");
		});

		it("joins lines with J", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("one\n  two");
			toNormal(editor);

			feed(editor, "J");

			assert.strictEqual(editor.getText(), "one two");
		});

		it("toggles case with ~ and steps right", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("abc");
			toNormal(editor);

			feed(editor, "~");

			assert.strictEqual(editor.getText(), "Abc");
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });
		});

		it("undoes with u", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("abc");
			toNormal(editor);

			feed(editor, "x", "u");

			assert.strictEqual(editor.getText(), "abc");
		});

		it("ignores an unknown motion after an operator", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("abc", { line: 0, col: 1 });
			toNormal(editor);

			feed(editor, "d", "?");

			assert.strictEqual(editor.getText(), "abc");
		});

		it("deletes counted lines with d2j", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("one\ntwo\nthree", { line: 0, col: 1 });
			toNormal(editor);

			feed(editor, "d", "2", "j");

			assert.strictEqual(editor.getText(), "three");
		});
	});

	describe("mode indicator", () => {
		it("renders INSERT while typing and NORMAL in normal mode", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("");
			editor.render(40);
			assert.match(editor.render(40).at(-1)!, /INSERT/);

			toNormal(editor);
			assert.match(editor.render(40).at(-1)!, /NORMAL/);
		});

		it("omits the indicator when vim mode is off", () => {
			const editor = createVimEditor("");
			editor.render(40);

			assert.doesNotMatch(editor.render(40).at(-1)!, /INSERT|NORMAL/);
		});

		it("omits the indicator while an operator is pending", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("abc");
			toNormal(editor);
			editor.render(40);

			editor.handleInput("d");

			assert.doesNotMatch(editor.render(40).at(-1)!, /NORMAL/);
		});
	});

	describe("activation", () => {
		it("does not run the state machine when vim mode is off", () => {
			const editor = createVimEditor("");
			editor.handleInput("x");

			assert.strictEqual(editor.getText(), "x");
			assert.strictEqual(editor.isVimEditing(), false);
		});

		it("lets unbound control keys through to Pi's own bindings", () => {
			setVimModeEnabled(true);
			const editor = createVimEditor("keep drop", { line: 0, col: 4 });
			toNormal(editor);

			editor.handleInput("\x0b"); // ctrl+k: delete to end of line

			assert.strictEqual(editor.getText(), "keep");
		});

		it("latches on at the first keypress after being enabled", () => {
			const editor = createVimEditor("abc");
			setVimModeEnabled(true);

			// Insert mode still: this keypress only activates the mode, so "!"
			// lands at the cursor instead of running a command.
			editor.handleInput("!");

			assert.strictEqual(editor.getText(), "!abc");
			assert.strictEqual(editor.isVimEditing(), true);
		});
	});
});

describe("autocomplete in vim mode", () => {
	async function createEditorWithPicker(): Promise<Editor> {
		setVimModeEnabled(true);
		const editor = createVimEditor("");
		editor.setAutocompleteProvider({
			triggerCharacters: [],
			getSuggestions: async () => ({
				prefix: "/",
				items: [
					{ value: "/one", label: "/one" },
					{ value: "/two", label: "/two" },
					{ value: "/three", label: "/three" },
				],
			}),
			applyCompletion: (lines, line, col, item, prefix) => {
				const updated = [...lines];
				const before = (lines[line] ?? "").slice(0, col - prefix.length);
				updated[line] = `${before}${item.value}`;
				return { lines: updated, cursorLine: line, cursorCol: before.length + item.value.length };
			},
		});
		type(editor, "/");
		await flushAutocomplete();
		assert.strictEqual(editor.isShowingAutocomplete(), true);
		return editor;
	}

	it("keeps the picker open when insert mode ends", async () => {
		const editor = await createEditorWithPicker();

		toNormal(editor);

		assert.strictEqual(editor.isShowingAutocomplete(), true);
	});

	it("moves the picker selection with j and accepts with Enter", async () => {
		const editor = await createEditorWithPicker();
		toNormal(editor);

		feed(editor, "j");
		editor.handleInput(ENTER);

		assert.strictEqual(editor.getText(), "/two");
		assert.strictEqual(editor.isShowingAutocomplete(), false);
	});

	it("accepts the picker with Tab in normal mode", async () => {
		const editor = await createEditorWithPicker();
		toNormal(editor);

		// Three k's walk back over all three items and wrap onto the first one.
		feed(editor, "k", "k", "k", "\t");

		assert.strictEqual(editor.getText(), "/one");
	});

	it("closes the picker on any other normal-mode key", async () => {
		const editor = await createEditorWithPicker();
		toNormal(editor);

		// `x` at column 0 has nothing to delete; what matters is the picker going.
		feed(editor, "x");

		assert.strictEqual(editor.isShowingAutocomplete(), false);
		assert.strictEqual(editor.getText(), "/");
	});
});

describe("vim navigation in pickers", () => {
	it("gives j and k up to the search box once a filter is typed", () => {
		setVimModeEnabled(true);

		assert.strictEqual(matchesVimListNav("j", "down"), true);
		assert.strictEqual(matchesVimListNav("j", "down", ""), true);
		assert.strictEqual(matchesVimListNav("j", "down", "a"), false);
	});

	it("claims nothing when vim mode is off", () => {
		assert.strictEqual(matchesVimListNav("j", "down"), false);
	});

	it("moves the selection with j and k", () => {
		setVimModeEnabled(true);
		const selected: string[] = [];
		const list = new SelectList(
			[
				{ value: "a", label: "a" },
				{ value: "b", label: "b" },
				{ value: "c", label: "c" },
			],
			3,
			defaultSelectListTheme,
		);
		list.onSelectionChange = (item) => selected.push(item.value);

		list.handleInput("j");
		list.handleInput("j");
		list.handleInput("k");

		assert.deepStrictEqual(selected, ["b", "c", "b"]);
		assert.strictEqual(list.getSelectedItem()?.value, "b");
	});

	it("does not treat j as navigation when vim mode is off", () => {
		const list = new SelectList(
			[
				{ value: "a", label: "a" },
				{ value: "b", label: "b" },
			],
			2,
			defaultSelectListTheme,
		);

		list.handleInput("j");

		assert.strictEqual(list.getSelectedItem()?.value, "a");
	});

	it("moves the settings selection with j while the filter is empty", () => {
		setVimModeEnabled(true);
		const changes: Array<[string, string]> = [];
		const theme: SettingsListTheme = {
			label: (text) => text,
			value: (text) => text,
			description: (text) => text,
			cursor: "-> ",
			hint: (text) => text,
		};
		const list = new SettingsList(
			[
				{ id: "alpha", label: "Alpha", currentValue: "1", values: ["1", "2"] },
				{ id: "beta", label: "Beta", currentValue: "2", values: ["1", "2"] },
			],
			5,
			theme,
			(id, value) => changes.push([id, value]),
			() => {},
			{ enableSearch: true },
		);
		list.render(40);

		list.handleInput("j");
		list.handleInput(ENTER);

		assert.deepStrictEqual(changes, [["beta", "1"]]);
	});
});
