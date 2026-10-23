import { describe, expect, test } from "vitest";

import {
	buildWriteClassifierMessages,
	classifyScript,
	classifyShellCommand,
	classifyWriteLocally,
	parseWriteClassifierAnswer,
} from "../src/core/write-classifier.ts";

describe("classifyWriteLocally", () => {
	test("decides known read-only and write tools without a command", () => {
		expect(classifyWriteLocally({ toolName: "read", args: { path: "a.ts" } })).toEqual({
			write: false,
			source: "tool",
		});
		expect(classifyWriteLocally({ toolName: "grep", args: {} })?.write).toBe(false);
		expect(classifyWriteLocally({ toolName: "edit", args: {} })?.write).toBe(true);
		expect(classifyWriteLocally({ toolName: "write", args: {} })?.write).toBe(true);
	});

	test("uses tool annotations for tools it does not know", () => {
		expect(classifyWriteLocally({ toolName: "mcp__db__query", args: {}, readOnlyHint: true })?.write).toBe(false);
		expect(classifyWriteLocally({ toolName: "mcp__db__drop", args: {}, destructiveHint: true })?.write).toBe(true);
		expect(classifyWriteLocally({ toolName: "mcp__db__query", args: {} })).toBeUndefined();
	});

	test("leaves a shell tool without a command undecided", () => {
		expect(classifyWriteLocally({ toolName: "bash", args: {} })).toBeUndefined();
	});
});

describe("classifyShellCommand", () => {
	test.each([
		["ls -la", false],
		["pwd", false],
		["cat notes.md | grep todo", false],
		["git status --short", false],
		["git diff HEAD~1 -- src", false],
		["git log --oneline -5", false],
		["rg -n 'rm -rf' src", false],
		["rg 'a => b' src", false],
		["rg 'npm install' docs", false],
		["git log --grep='git commit' -n 3", false],
		["cd packages/coding-agent && git status", false],
		["curl -fsSLo out.json https://example.com", true],
		["wget -qO- https://example.com", false],
		["wget https://example.com/x.zip", undefined],
		["sed -n '1,20p' notes.md", false],
		["find . -name '*.ts' -not -path './node_modules/*'", false],
		["ls > /dev/null", false],
		["env FOO=1 rg bar", false],
		["sudo ls", false],
		["echo done; git status", false],
		["echo hi > out.txt", true],
		["cat > notes.md <<'EOF'\nhi\nEOF", true],
		["rm -rf build", true],
		["mv a b", true],
		["sudo rm -rf build", true],
		["sed -i 's/a/b/' notes.md", true],
		["find . -name '*.ts' -delete", true],
		["git commit -m 'x'", true],
		["git checkout -- .", true],
		["npm install", true],
		["chmod +x run.sh", true],
		["python - <<'PY'\nopen('out.txt', 'w').write('hi')\nPY", true],
		["python - <<'PY'\nprint(1)\nPY", undefined],
		["python -c \"open('x','w')\"", true],
		["npm run check", undefined],
		["curl -o out.json https://example.com", true],
		["curl -s https://example.com", false],
		["echo $(date)", undefined],
		["./scripts/collect.sh --all", undefined],
		["Remove-Item -Recurse build", true],
	])("%s", (command, expected) => {
		expect(classifyShellCommand(command)).toBe(expected);
	});
});

describe("classifyScript", () => {
	test("decides read-only tool calls and file writes", () => {
		expect(classifyScript("const a = await tools.read({ path: 'a.ts' }); return a.data;")).toBe(false);
		expect(classifyScript("await tools.write({ path: 'a.ts', content: 'x' });")).toBe(true);
		expect(classifyScript("await tools.grep({ pattern: 'x' }); await tools.ls({});")).toBe(false);
	});

	test("leaves a script with shell calls or no calls undecided", () => {
		expect(classifyScript("await tools.bash({ command: 'ls' });")).toBeUndefined();
		expect(classifyScript("store('cursor', 1);")).toBeUndefined();
	});
});

describe("classifyWriteWithModel inputs", () => {
	test("keeps the system prompt stable and shows the command verbatim", () => {
		const first = buildWriteClassifierMessages({ toolName: "bash", args: { command: "npm run build" } });
		const second = buildWriteClassifierMessages({ toolName: "bash", args: { command: "ls" } });
		expect(first.systemPrompt).toBe(second.systemPrompt);
		expect(first.messages[0]?.content).toContain("tool: bash");
		expect(first.messages[0]?.content).toContain("npm run build");
	});

	test("bounds a huge argument", () => {
		const command = `echo ${"x".repeat(20000)}`;
		const { messages } = buildWriteClassifierMessages({ toolName: "bash", args: { command } });
		const content = messages[0]?.content as string;
		expect(content.length).toBeLessThan(7000);
		expect(content).toContain("characters omitted");
	});
});

describe("parseWriteClassifierAnswer", () => {
	test.each([
		["true", true],
		["TRUE.", true],
		["  false\n", false],
		["`False`", false],
		["true, it writes files", true],
		["maybe", undefined],
		["", undefined],
	])("%j", (answer, expected) => {
		expect(parseWriteClassifierAnswer(answer)).toBe(expected);
	});
});
