# Vim Mode

Set `editorMode` to `"vim"` in your settings, or cycle **Editor mode** to `vim` in `/settings`. The change applies immediately; no restart needed.

```json
{
  "editorMode": "vim"
}
```

Vim keys are fixed. They are not part of the [keybindings](keybindings.md) registry, because `j` is a motion in the editor and a filter character in a search box — one global table cannot mean both.

## Editor

Vim mode starts in **insert**: a prompt is typed, not navigated. The mode is shown at the right end of the editor's bottom border.

The editor cursor follows the mode: bar in insert, inverted block in normal. When the `showHardwareCursor` setting is on, the hardware cursor does the same (bar/block via DECSCUSR). Toggling vim mode off restores the terminal's default cursor style.

**Escape** leaves insert mode for normal mode. While vim mode is on, Escape is a mode key, so it no longer triggers the abort action bound to `app.interrupt` (Escape by default). Use **Ctrl+C** to clear the editor and stop the agent. Escape is a no-op in normal mode.

Ctrl+D keeps its Pi meaning of "exit when the editor is empty", so it only scrolls the editor once there is text in it.

### Insert mode

Everything behaves as it does without vim mode: arrows, Ctrl combinations, Tab, and Enter all work. Enter submits the prompt.

### Normal mode motions

| Keys | Moves to |
|---|---|
| `h` `l` | Character left / right, stopping at the line edge |
| `j` `k` | Line down / up |
| `0` | Start of the line |
| `^` | First non-blank character |
| `$` | Last character of the line |
| `w` `b` `e` | Start of next word, start of previous word, last character of word |
| `gg` / `{count}gg` | First non-blank character of line 1 / of line `{count}` |
| `G` / `{count}G` | Last line / line `{count}` |
| `f{char}` `F{char}` | Forward / backward to `{char}` |
| `t{char}` `T{char}` | Same, stopping just before `{char}` |
| `Ctrl+D` `Ctrl+U` | Down / up half a page (when the editor has text; Ctrl+D is Pi's exit binding on an empty editor) |
| `Ctrl+F` `Ctrl+B` | Down / up a page |
| `Ctrl+P` `Ctrl+N` | Previous / next prompt in history |
| `{count}` before any of the above | Repeat that many times |

The cursor rests on a character in normal mode, so `$` and `w` stop on the last character rather than past it.

Control keys vim leaves unbound still reach Pi: Ctrl+W deletes a word, Ctrl+K deletes to the end of the line, and Ctrl+] starts a character jump.

### Operators

`d` (delete), `c` (change), and `y` (yank) take a motion: `dw`, `d$`, `d2j`, `cw`, `yiw`. Repeating the operator makes it apply to whole lines: `dd`, `cc`, `yy`. A `j`, `k`, `gg`, or `G` motion is also linewise, so `dj` removes two lines.

Deleting forward with a motion owns the character it lands on, backward motions stop before it. `dw` on the last word of a line behaves like `de`, and deletes the rest of that word.

### Editing

| Keys | Action |
|---|---|
| `i` `a` | Insert before / after the character under the cursor |
| `I` `A` | Insert at the first non-blank character / end of the line |
| `o` `O` | Open a line below / above and insert |
| `/` | Enter insert mode and type `/`; at a message start this opens the slash command menu |
| `x` `X` | Delete `{count}` characters forward / backward, never across a line |
| `D` `C` | Delete / change to the end of the line |
| `s` `S` | Substitute the character under the cursor / clear the line, then insert |
| `p` `P` | Paste the last kill or yank below / above |
| `r{char}` | Replace `{count}` characters with `{char}` |
| `J` | Join the next line onto this one |
| `~` | Toggle case and step right |
| `u` | Undo |

`p` and `P` paste a whole line after a `dd`/`yy` and inline after any other kill, matching what is on the kill ring.

### Autocomplete

Escape leaves insert mode but keeps the autocomplete list open, so normal mode can walk it: `j` `k` (or `Ctrl+N` `Ctrl+P`) move the selection and Tab or Enter accepts it. Escape, or any other key, dismisses the list and runs as a normal-mode command.

## Pickers

`j` and `k` move the selection in the model, session, theme, thinking, settings, tree, message, and config pickers, alongside the arrow keys.

Once a picker's search box has text in it, `j` and `k` type into the box again. A keypress can only mean one thing, and the search box claims it as soon as you start filtering.

## Transcript

In normal mode, `j` and `k` scroll the transcript once the cursor runs out of lines to move to, the same way vim scrolls the window when the buffer is shorter than the screen. `Ctrl+D` and `Ctrl+U` page the editor itself.

The transcript does not scroll horizontally, so `h` and `l` have nothing to do outside the editor. Use PageUp and PageDown to page the transcript.

Transcript search keeps every printable key while it is open.

## Not included

Visual mode, named registers, macros, `.` to repeat a change, and `n`/`N` search. The `/` key opens the slash command menu instead, since the editor is a prompt field rather than a file buffer. Use the transcript search (**Ctrl+F**) to search the conversation, and Ctrl+Z in insert mode to undo.