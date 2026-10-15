/**
 * Global vim mode state and the vim key aliases shared across components.
 *
 * Vim mode is opt-in. The app calls setVimModeEnabled() when the user turns it
 * on; the coding agent drives it from the `editorMode` setting. While enabled:
 *
 * - the editor runs a normal/insert modal state machine (components/editor.ts)
 * - list pickers accept `j`/`k` next to the arrow keys
 * - the transcript viewport accepts `j`/`k`, `ctrl+d`/`ctrl+u`, `gg`/`G`
 *
 * Vim keys are deliberately not routed through the keybinding registry: `j` is
 * a motion in the editor and a filter character in a search box, so a single
 * global binding table cannot express both. Pickers therefore opt in per
 * component via matchesVimListNav().
 */

import { matchesKey } from "./keys.ts";

/**
 * Modal state of a vim-driven editor.
 *
 * There is no "visual" mode yet; `normal` covers the command state and `insert`
 * the typing state. Vim mode starts in normal, like vim: the first keypress is
 * a command, and `i` enters the typing state. After a submit the editor resets
 * to insert (startinsert) so the next prompt can be typed right away.
 */
export type VimEditorMode = "normal" | "insert";

let vimModeEnabled = false;

/** Whether vim mode is currently enabled. */
export function isVimModeEnabled(): boolean {
	return vimModeEnabled;
}

/** Enable or disable vim mode. Editors pick this up on the next keypress. */
export function setVimModeEnabled(enabled: boolean): void {
	vimModeEnabled = enabled;
}

/**
 * True when `data` is the vim navigation key for `direction` ("j" down, "k" up).
 *
 * `filterQuery` is the picker's current filter text. Once it is non-empty the
 * search box owns every printable key, so vim navigation steps aside and `j`/`k`
 * go back to being ordinary characters: a keypress can only mean one thing, and
 * the search box already claimed it. Pickers without a search box omit it.
 */
export function matchesVimListNav(data: string, direction: "up" | "down", filterQuery?: string): boolean {
	if (!vimModeEnabled) return false;
	if (filterQuery) return false;
	return matchesKey(data, direction === "down" ? "j" : "k");
}
