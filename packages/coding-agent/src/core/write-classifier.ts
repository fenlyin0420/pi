/**
 * Write-operation classification for tool calls.
 *
 * A call is a write operation when it can leave persistent changes on the machine: creating,
 * modifying, moving, or deleting files, changing git or package state, or writing files from a shell
 * heredoc or a script. The transcript marks such calls with a bar on their left edge.
 *
 * Local rules decide the common cases without a model call: known read-only and write tools, tool
 * annotations, and shell commands that are clearly read-only or clearly writing. Everything else,
 * such as a Python heredoc, a shell script, or an unknown tool, goes to a small model that answers
 * with one word.
 */

import { type AssistantMessageEventStream, normalizeContext, type UserMessage } from "@earendil-works/pi-ai";
import type {
	Api,
	AssistantMessage,
	Model,
	ProviderHeaders,
	SimpleStreamOptions,
	TextContent,
	TranscriptContext,
} from "@earendil-works/pi-ai/compat";

/** What decided a verdict: the tool itself, its command text, or the classifier model. */
export type WriteVerdictSource = "tool" | "command" | "classifier";

/** Whether one tool call writes, and why. */
export interface WriteVerdict {
	/** Whether the call writes. */
	write: boolean;
	/** What decided it. */
	source: WriteVerdictSource;
}

/** One tool call to classify. */
export interface WriteClassificationInput {
	/** Tool name as the model called it. */
	toolName: string;
	/** Validated tool arguments. */
	args: unknown;
	/** `readOnlyHint` from the tool's annotations, when it declares them. */
	readOnlyHint?: boolean;
	/** `destructiveHint` from the tool's annotations, when it declares them. */
	destructiveHint?: boolean;
}

/** The model that decides calls the local rules leave open. */
export interface WriteClassifierModel {
	model: Model<Api>;
	streamFn: (
		model: Model<Api>,
		context: TranscriptContext,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;
	apiKey?: string;
	headers?: ProviderHeaders;
	/** Session id, for providers that need it to route a request (OpenCode, for example). */
	sessionId?: string;
	/** Give up after this many milliseconds. Default {@link DEFAULT_WRITE_CLASSIFIER_TIMEOUT_MS}. */
	timeoutMs?: number;
}

export const DEFAULT_WRITE_CLASSIFIER_TIMEOUT_MS = 10000;

/** How many classifier calls may run at once. Further undecided calls stay unmarked for the session. */
export const MAX_CONCURRENT_WRITE_CLASSIFIER_CALLS = 3;

/** Answers kept for repeated calls; the oldest is dropped first. */
export const MAX_WRITE_CLASSIFIER_CACHE_ENTRIES = 1000;

/**
 * Custom session entry holding one call's verdict. Only write verdicts are stored: an absent entry
 * means "not a write", so a resumed session keeps every marker without an entry per read call.
 */
export const WRITE_VERDICT_ENTRY_TYPE = "pi.write-verdict";

/** One persisted verdict. */
export interface WriteVerdictEntryData {
	toolCallId: string;
	source: WriteVerdictSource;
}

/** Read a persisted verdict entry's data, or undefined when it is not one. */
export function readWriteVerdictEntry(data: unknown): WriteVerdictEntryData | undefined {
	if (!data || typeof data !== "object") return undefined;
	const record = data as Record<string, unknown>;
	const toolCallId = record.toolCallId;
	const source = record.source;
	if (typeof toolCallId !== "string" || toolCallId.length === 0) return undefined;
	if (source !== "tool" && source !== "command" && source !== "classifier") return undefined;
	return { toolCallId, source };
}

/** A bounded key for one call, so identical calls reuse a single model answer. */
export function writeClassifierCacheKey(input: WriteClassificationInput): string {
	const text = `${input.toolName}\n${JSON.stringify(input.args ?? null)}`;
	let hash = 5381;
	for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
	return `${input.toolName}:${text.length}:${(hash >>> 0).toString(36)}`;
}

/** Read-only tools: they only read, search, or display. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
	"read",
	"read_file",
	"grep",
	"find",
	"ls",
	"list",
	"list_files",
	"glob",
	"web_search",
	"fetch_content",
	"get_search_content",
	"source_check",
	"symbol_search",
	"project_report",
	"module_report",
	"read_symbol",
	"read_enclosing",
	"bash_output",
]);

/** Tools that write by definition. */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
	"write",
	"write_file",
	"create_file",
	"edit",
	"edit_file",
	"multiedit",
	"multi_edit",
	"apply_patch",
	"patch",
	"str_replace",
	"str_replace_editor",
	"notebook_edit",
	"delete_file",
	"move_file",
	"rename_file",
]);

/** Tools whose arguments hold a shell command. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);

/** Tools whose arguments hold a script that calls other tools. */
const SCRIPT_TOOLS: ReadonlySet<string> = new Set(["codemode"]);

/** Words that wrap the actual command without changing whether it writes. */
const WRAPPER_WORDS: ReadonlySet<string> = new Set([
	"sudo",
	"doas",
	"env",
	"time",
	"nohup",
	"command",
	"builtin",
	"exec",
	"nice",
	"ionice",
	"stdbuf",
	"xargs",
]);

/** Commands that only read, in every invocation. */
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
	"ls",
	"ll",
	"cat",
	"bat",
	"head",
	"tail",
	"less",
	"more",
	"wc",
	"pwd",
	"echo",
	"printf",
	"which",
	"type",
	"file",
	"stat",
	"du",
	"df",
	"tree",
	"rg",
	"grep",
	"egrep",
	"fgrep",
	"ack",
	"ag",
	"jq",
	"yq",
	"cut",
	"sort",
	"uniq",
	"tr",
	"diff",
	"cmp",
	"comm",
	"join",
	"column",
	"paste",
	"tac",
	"seq",
	"date",
	"whoami",
	"hostname",
	"uname",
	"id",
	"printenv",
	"nl",
	"xxd",
	"hexdump",
	"od",
	"base64",
	"md5sum",
	"sha1sum",
	"sha256sum",
	"realpath",
	"dirname",
	"basename",
	"readlink",
	"sleep",
	"true",
	"false",
	"test",
	"expr",
	"bc",
	"ps",
	"free",
	"git",
	"curl",
	"wget",
	"sed",
	"find",
]);

/** Commands that change only the shell's own state, so they neither read nor write files. */
const NEUTRAL_COMMANDS: ReadonlySet<string> = new Set([
	"cd",
	"pushd",
	"popd",
	"export",
	"unset",
	"set",
	"shift",
	"umask",
]);

/**
 * Commands that are read-only only in some invocations: the arguments must match, or the call stays
 * undecided and goes to the model.
 */
const READ_ONLY_ARGUMENT_GUARDS: Readonly<Record<string, RegExp>> = {
	git: /^\s*(?:status|diff|log|show|blame|rev-parse|describe|ls-files|ls-tree|cat-file|shortlog|count-objects|grep|whatchanged|reflog|config\s+(?:get|list)|remote\s+(?:-v|show)|branch\s+(?:-a|-r|-l|--list|--show-current)|stash\s+list|tag\s+(?:-l|--list))\b/,
	// A clustered short flag counts too: `-fsSLo out.json` writes, `-qO-` prints to stdout.
	curl: /^(?![\s\S]*(?:^|\s)(?:-[A-Za-z]*[oO]|-T|-[dFXK]|--output|--upload-file|--data[\w-]*|--form|--request|--json)\b)/,
	wget: /(?:^|\s)-[A-Za-z]*O-/,
	sed: /^(?![\s\S]*(?:^|\s)(?:-i|-i\.|--in-place|--in-place=))/,
	find: /^(?![\s\S]*(?:^|\s)(?:-(?:delete|exec|execdir|ok|okdir|fls|fprint|fprintf))\b)/,
	sort: /^(?![\s\S]*(?:^|\s)(?:-o|--output)\b)/,
};

/** Flags that turn a guarded read-only command into a write. */
const WRITE_ARGUMENT_FLAGS: Readonly<Record<string, RegExp>> = {
	sed: /(?:^|\s)(?:-i|-i\.|--in-place)/,
	find: /(?:^|\s)-(?:delete|exec|execdir|ok|okdir|fls|fprint|fprintf)\b/,
	sort: /(?:^|\s)(?:-o|--output)\b/,
	curl: /(?:^|\s)(?:-[A-Za-z]*[oO]|-T|--output|--upload-file)\b/,
};

/** Commands that write, in every invocation. */
const WRITE_COMMAND_PATTERN =
	/\b(?:rm|rmdir|unlink|shred|truncate|mv|cp|install|mkdir|mkfifo|mknod|touch|ln|chmod|chown|chgrp|chattr|setfacl|dd|tee|patch|rsync|wipefs|mkfs(?:\.\w+)?|mount|umount|kill|pkill|killall|shutdown|reboot|systemctl|service|launchctl|Remove-Item|Remove-ItemProperty|Set-Item|Set-ItemProperty|Set-Content|Add-Content|Clear-Content|Out-File|New-Item|Copy-Item|Move-Item|Rename-Item|Start-Process|Stop-Process)\b/;

/** Command prefixes that write: git mutations and package or system state changes. */
const WRITE_COMMAND_PREFIX_PATTERN = new RegExp(
	[
		"\\bgit\\s+(?:add|commit|checkout|switch|restore|reset|clean|rm|mv|merge|rebase|cherry-pick|revert|stash|apply|am|pull|push|fetch|clone|init|tag|update-ref|gc|prune|worktree|submodule|filter-branch|notes|config\\s+(?:set|unset|add))\\b",
		"\\b(?:npm|pnpm|yarn|bun|pip|pip3|uv|poetry|conda|cargo|go|gem|composer|apt|apt-get|dnf|yum|pacman|brew|apk|snap|nix|nix-env|docker|kubectl|helm|terraform|gh)\\s+(?:i|install|add|remove|uninstall|rm|delete|del|update|upgrade|ci|link|unlink|publish|apply|create|push|edit|set|prune|tag|release|deploy)\\b",
		"\\b(?:powershell|pwsh)\\b[\\s\\S]*\\b(?:Remove-Item|Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Rename-Item|Clear-Content|Invoke-WebRequest[\\s\\S]*-(?:OutFile|Method\\s+Post))\\b",
	].join("|"),
);

/** Write calls inside a script or heredoc body. */
const SCRIPT_WRITE_PATTERN = new RegExp(
	[
		"\\bopen\\s*\\([^)]*['\"][wa+]",
		"\\bwriteFile(?:Sync)?\\s*\\(",
		"\\bappendFile(?:Sync)?\\s*\\(",
		"\\bcreateWriteStream\\s*\\(",
		"\\.write_text\\s*\\(",
		"\\.write_bytes\\s*\\(",
		"\\bos\\.(?:remove|unlink|rename|replace|mkdir|makedirs|rmdir|chmod|chown|symlink|link|truncate|utime|system|popen)\\b",
		"\\bshutil\\.(?:copy\\w*|move|rmtree|copytree|make_archive)\\b",
		"\\bsubprocess\\.\\w+",
		"\\bPath\\s*\\([^)]*\\)\\s*\\.\\s*(?:write|unlink|mkdir|touch|rename|replace)\\w*\\s*\\(",
		"\\b(?:fs|fsp|deno)\\.(?:writeFile|writeFileSync|appendFile|unlink|rm|mkdir|mkdirSync|rmdir|rename|copyFile|chmod|createWriteStream)\\b",
		"\\bfs\\.promises\\.\\w+",
	].join("|"),
);

/** A redirect to a real file; `> /dev/null` and `2>&1` do not write. */
const FILE_REDIRECT_PATTERN = /(?:^|[^|&=-])>{1,2}\s*[^\s|&;)]/;

function normalizeArgs(args: unknown): Record<string, unknown> {
	return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" ? value : undefined;
}

/** Classify a call from the tool's name, annotations, and command text alone. */
export function classifyWriteLocally(input: WriteClassificationInput): WriteVerdict | undefined {
	const toolName = input.toolName.trim().toLowerCase();
	if (WRITE_TOOLS.has(toolName)) return { write: true, source: "tool" };
	if (input.destructiveHint === true) return { write: true, source: "tool" };
	if (READ_ONLY_TOOLS.has(toolName)) return { write: false, source: "tool" };
	if (input.readOnlyHint === true) return { write: false, source: "tool" };

	const args = normalizeArgs(input.args);
	if (SHELL_TOOLS.has(toolName)) {
		const command = stringArg(args, "command");
		const decided = command === undefined ? undefined : classifyShellCommand(command);
		return decided === undefined ? undefined : { write: decided, source: "command" };
	}
	if (SCRIPT_TOOLS.has(toolName)) {
		const code = stringArg(args, "code");
		const decided = code === undefined ? undefined : classifyScript(code);
		return decided === undefined ? undefined : { write: decided, source: "command" };
	}
	return undefined;
}

/**
 * Classify a shell command from its text. Returns undefined when the command is plausible either
 * way, so the model decides.
 */
export function classifyShellCommand(command: string): boolean | undefined {
	const text = command
		.trim()
		.replace(/\d?>>?\s*\/dev\/null/g, " ")
		.replace(/&>>?\s*\/dev\/null/g, " ")
		.replace(/\d?>&\d/g, " ");
	if (!text) return undefined;
	// Redirects are never inside quotes; quoted spans also never hold a heredoc marker.
	const unquoted = stripQuotedRegions(text);
	if (FILE_REDIRECT_PATTERN.test(unquoted)) return true;

	// A heredoc or a command substitution hides code that the segments below cannot see.
	if (/<<<?/.test(unquoted) || /`|\$\(/.test(text)) {
		if (SCRIPT_WRITE_PATTERN.test(text)) return true;
		return undefined;
	}

	const segments = splitShellSegments(text);
	if (segments === undefined) return undefined;
	if (segments.length === 0) return undefined;

	let allReadOnly = true;
	for (const segment of segments) {
		const kind = classifyShellSegment(segment);
		if (kind === "write") return true;
		if (kind !== "read") allReadOnly = false;
	}
	if (allReadOnly) return false;
	if (SCRIPT_WRITE_PATTERN.test(text)) return true;
	if (WRITE_COMMAND_PATTERN.test(unquoted) || WRITE_COMMAND_PREFIX_PATTERN.test(unquoted)) return true;
	return undefined;
}

/** Classify a `codemode` script from the tools it calls and any file writes in its own code. */
export function classifyScript(code: string): boolean | undefined {
	const text = code.trim();
	if (!text) return undefined;
	if (SCRIPT_WRITE_PATTERN.test(text)) return true;

	// Codemode identifiers keep letters, digits, and underscores; that is close enough to tool names
	// for the built-in tools, and anything else falls through to the model.
	const called = [...text.matchAll(/\btools\.([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]!);
	if (called.some((name) => WRITE_TOOLS.has(name))) return true;
	if (called.length === 0) return undefined;
	const allReadOnly = called.every((name) => READ_ONLY_TOOLS.has(name));
	return allReadOnly ? false : undefined;
}

/** Replace quoted spans with spaces, so scanning only sees unquoted shell syntax. */
function stripQuotedRegions(text: string): string {
	let result = "";
	let quote: string | undefined;
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		if (quote) {
			if (char === "\\" && quote !== "'" && i + 1 < text.length) {
				i++;
				result += "  ";
				continue;
			}
			if (char === quote) quote = undefined;
			result += " ";
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			result += " ";
			continue;
		}
		result += char;
	}
	return result;
}

type SegmentKind = "read" | "write" | "unknown";

function classifyShellSegment(segment: string): SegmentKind {
	const words = segment.trim().split(/\s+/).filter(Boolean);
	let index = 0;
	while (index < words.length) {
		const word = words[index]!.replace(/^[({\s]+/, "");
		if (WRAPPER_WORDS.has(word)) {
			index++;
			// Skip a wrapper's own flags and its numeric or variable arguments.
			while (index < words.length && /^(-{1,2}[\w-]+|\d+|[\w.-]+=[^\s]*)$/.test(words[index]!)) index++;
			continue;
		}
		if (/^[\w.-]+=/.test(word)) {
			// A leading variable assignment, as in `FOO=1 cmd`.
			index++;
			continue;
		}
		break;
	}
	const command = words[index]?.replace(/^[({\s]+/, "").replace(/[(){}\s]+$/, "");
	if (!command) return "unknown";
	// Quoted arguments never decide the verdict: `rg 'npm install' docs` only searches.
	const argumentText = stripQuotedRegions(words.slice(index + 1).join(" "));
	if (NEUTRAL_COMMANDS.has(command)) return "read";
	if (READ_ONLY_COMMANDS.has(command)) {
		const guard = READ_ONLY_ARGUMENT_GUARDS[command];
		if (!guard || guard.test(argumentText)) return "read";
		return WRITE_ARGUMENT_FLAGS[command]?.test(argumentText) ? "write" : "unknown";
	}
	const unquoted = stripQuotedRegions(segment);
	if (WRITE_COMMAND_PATTERN.test(command) || WRITE_COMMAND_PREFIX_PATTERN.test(unquoted)) return "write";
	return "unknown";
}

/**
 * Split a command into the segments joined by `|`, `&&`, `||`, `;`, and newlines. Returns undefined
 * for input this simple scanner cannot trust, such as unbalanced quotes.
 */
function splitShellSegments(text: string): string[] | undefined {
	const segments: string[] = [];
	let current = "";
	let quote: string | undefined;
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		if (quote) {
			current += char;
			if (char === "\\" && quote !== "'" && i + 1 < text.length) {
				current += text[++i]!;
			} else if (char === quote) {
				quote = undefined;
			}
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}
		if (char === "|" || char === ";" || char === "\n" || char === "&") {
			if (char === "|" && text[i + 1] === "|") i++;
			else if (char === "&" && text[i + 1] === "&") i++;
			segments.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (quote) return undefined;
	segments.push(current);
	return segments.filter((segment) => segment.trim().length > 0);
}

// Keep this short: it runs once per undecided call, so every token is a per-call cost. The system
// prompt is identical across calls, which lets providers cache it.
const WRITE_CLASSIFIER_SYSTEM_PROMPT = [
	"Classify one tool call of a coding agent. Answer with exactly one word: true or false.",
	"true: the call writes. It creates, modifies, renames, moves, or deletes files or directories, changes git, package, process, or system state, or leaves other persistent changes behind. Redirects, in-place edits, installs, builds, formatters, snapshot updates, coverage output, file writes done by a heredoc or a script, and a network request that changes remote state (POST, PUT, PATCH, DELETE) count, even when the command looks read-only.",
	"false: the call only reads or verifies. It reads, searches, lists, diffs, inspects, fetches over the network, or runs tests, type checks, and linters that report a result without changing files or remote state.",
	"Answer true or false.",
].join(" ");

/** The arguments shown to the classifier: bounded so one huge argument cannot dominate the call. */
const MAX_CLASSIFIER_ARGUMENT_CHARS = 6000;

/** Build the messages for the classifier model. */
export function buildWriteClassifierMessages(input: WriteClassificationInput): {
	systemPrompt: string;
	messages: UserMessage[];
} {
	const args = normalizeArgs(input.args);
	const text = stringArg(args, "command") ?? stringArg(args, "code");
	const payload = text === undefined ? JSON.stringify(input.args ?? null) : text;
	return {
		systemPrompt: WRITE_CLASSIFIER_SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: `tool: ${input.toolName}\narguments:\n${truncateArgument(payload)}`,
				timestamp: Date.now(),
			},
		],
	};
}

function truncateArgument(text: string): string {
	if (text.length <= MAX_CLASSIFIER_ARGUMENT_CHARS) return text;
	const head = text.slice(0, MAX_CLASSIFIER_ARGUMENT_CHARS - 1500);
	const tail = text.slice(-1500);
	return `${head}\n... (${text.length - MAX_CLASSIFIER_ARGUMENT_CHARS} characters omitted) ...\n${tail}`;
}

/** Read a `true` or `false` answer, or undefined when the model answered something else. */
export function parseWriteClassifierAnswer(text: string): boolean | undefined {
	const answer = text
		.trim()
		.toLowerCase()
		.replace(/[^a-z]/g, "");
	if (answer.startsWith("true")) return true;
	if (answer.startsWith("false")) return false;
	return undefined;
}

/**
 * Ask the classifier model whether the call writes. Returns undefined when the call is unavailable,
 * times out, or answers with something unparsable, so the caller keeps the verdict undecided.
 */
export async function classifyWriteWithModel(
	classifier: WriteClassifierModel,
	input: WriteClassificationInput,
	signal?: AbortSignal,
): Promise<boolean | undefined> {
	const startedAt = Date.now();
	try {
		const timeout = AbortSignal.timeout(classifier.timeoutMs ?? DEFAULT_WRITE_CLASSIFIER_TIMEOUT_MS);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const { systemPrompt, messages } = buildWriteClassifierMessages(input);
		const stream = await classifier.streamFn(classifier.model, normalizeContext({ systemPrompt, messages }), {
			temperature: 0,
			// Some chat models think before answering even with reasoning disabled, so the budget covers
			// a short thinking block on top of the one-word answer; without it the answer is truncated.
			maxTokens: 256,
			reasoning: undefined,
			signal: combined,
			apiKey: classifier.apiKey,
			headers: classifier.headers,
			...(classifier.sessionId ? { sessionId: classifier.sessionId } : {}),
		} satisfies SimpleStreamOptions);
		// Race the timeout too, so a stream that ignores the signal cannot keep the verdict pending.
		const message = await Promise.race<AssistantMessage | undefined>([
			stream.result(),
			new Promise<undefined>((resolve) =>
				timeout.addEventListener("abort", () => resolve(undefined), { once: true }),
			),
		]);
		if (!message) {
			if (process.env.PI_DEBUG_WRITE_CLASSIFIER) console.error("[write-classifier] classifier: timeout");
			return undefined;
		}
		if (message.stopReason !== "stop" && message.stopReason !== "length") {
			if (process.env.PI_DEBUG_WRITE_CLASSIFIER) {
				console.error(
					`[write-classifier] classifier: stopReason=${message.stopReason} error=${message.errorMessage ?? ""}`,
				);
			}
			return undefined;
		}
		const text = message.content
			.filter((part): part is TextContent => part.type === "text")
			.map((part) => part.text)
			.join("");
		if (process.env.PI_DEBUG_WRITE_CLASSIFIER) {
			console.error(
				`[write-classifier] classifier answer raw=${JSON.stringify(text)} after ${Date.now() - startedAt}ms`,
			);
		}
		return parseWriteClassifierAnswer(text);
	} catch (error) {
		if (process.env.PI_DEBUG_WRITE_CLASSIFIER) {
			console.error(`[write-classifier] classifier error: ${(error as Error).message ?? String(error)}`);
		}
		return undefined;
	}
}
