import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR, getAgentDir } from "../src/config.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";

describe("extension host config dir", () => {
	let tempDir: string;
	let extensionsDir: string;
	let originalAgentDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ext-agentdir-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
		originalAgentDir = process.env[ENV_AGENT_DIR];
		delete process.env[ENV_AGENT_DIR];
	});

	afterEach(() => {
		if (originalAgentDir === undefined) {
			delete process.env[ENV_AGENT_DIR];
		} else {
			process.env[ENV_AGENT_DIR] = originalAgentDir;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const probeCode = (outFile: string) => `
		import * as fs from "node:fs";
		fs.writeFileSync(${JSON.stringify(outFile)}, process.env.PI_CODING_AGENT_DIR ?? "<unset>");
		export default function(pi) {
			pi.registerCommand("probe", { handler: async () => {} });
		}
	`;

	it("names pi's config dir before importing extension modules", async () => {
		const outFile = path.join(tempDir, "seen.txt");
		fs.writeFileSync(path.join(extensionsDir, "probe.ts"), probeCode(outFile));

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);

		expect(result.errors).toEqual([]);
		expect(process.env[ENV_AGENT_DIR]).toBe(getAgentDir());
		expect(process.env[ENV_AGENT_DIR]).toBe(path.join(os.homedir(), ".pi", "agent"));
		expect(fs.readFileSync(outFile, "utf-8")).toBe(getAgentDir());
	});

	it("keeps an explicitly configured config dir", async () => {
		const customDir = path.join(tempDir, "custom-agent");
		process.env[ENV_AGENT_DIR] = customDir;
		const outFile = path.join(tempDir, "seen.txt");
		fs.writeFileSync(path.join(extensionsDir, "probe.ts"), probeCode(outFile));

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);

		expect(result.errors).toEqual([]);
		expect(process.env[ENV_AGENT_DIR]).toBe(customDir);
		expect(fs.readFileSync(outFile, "utf-8")).toBe(customDir);
	});
});
