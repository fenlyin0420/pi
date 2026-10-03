#!/usr/bin/env node
// fork 载体 · 断言：「不进入 dist」必须被证明，而不是"看上去没有"。
//
// 1 产物层    prune.txt 的规则在 dist 里不再匹配到任何文件
// 2 反向断言  bundle 里不得出现 OAuth 登录流的特征字符串；且必须出现替身的错误文案
// 3 语义断言  加载器替身真的在生效；导出集合与上游一致（漂移探测）；
//             斜杠命令表恰好等于"上游名单 − {login, logout}"
// 4 冒烟      构建出的 CLI 能启动

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const forkDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(forkDir, "..");
const failures = [];

function check(label, fn) {
	try {
		const detail = fn();
		console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
	} catch (error) {
		failures.push(`${label}: ${error.message}`);
		console.log(`  ✗ ${label} — ${error.message}`);
	}
}

async function checkAsync(label, fn) {
	try {
		const detail = await fn();
		console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
	} catch (error) {
		failures.push(`${label}: ${error.message}`);
		console.log(`  ✗ ${label} — ${error.message}`);
	}
}

// ── 1 产物层 ────────────────────────────────────────────────────────────────
console.log("1) 产物层");
const patterns = readFileSync(join(forkDir, "prune.txt"), "utf8")
	.split("\n")
	.map((line) => line.trim())
	.filter((line) => line.length > 0 && !line.startsWith("#"));
check(`prune.txt 的 ${patterns.length} 条规则均无残留文件`, () => {
	const leftovers = [];
	for (const pattern of patterns) {
		const dir = join(repoRoot, dirname(pattern));
		if (!existsSync(dir)) continue;
		const prefix = pattern.slice(pattern.lastIndexOf("/") + 1).replace(/\*$/, "");
		for (const entry of readdirSync(dir)) if (entry.startsWith(prefix)) leftovers.push(join(dir, entry));
	}
	if (leftovers.length > 0) throw new Error(`仍有残留：${leftovers.map((f) => relative(repoRoot, f)).join(", ")}`);
});

// ── 2 反向断言（bundle 层）──────────────────────────────────────────────────
console.log("2) 反向断言（bundle 层）");
const bundleDir = join(repoRoot, "packages/coding-agent/dist/bundle");

// 标记必须是"只在 pi 自己的 OAuth 流实现里出现"的字符串。
// 两条都实际踩过：
//   · "auth.openai.com" 不是流独有 —— openai SDK 的 workload identity 里也有，会假阳性；
//   · RFC 8628 的 device_code URN 同样被第三方 SDK 使用。
// 所以断言里同时验证"唯一性"：一旦上游把这些 URL 用到别处，断言立刻失败而不是静静放行。
const OAUTH_FLOW_MARKERS = [
	"https://claude.ai/oauth/authorize",
	"https://platform.claude.com/oauth/code/callback",
	"https://auth.openai.com/api/accounts/authorize",
	"https://openrouter.ai/auth",
	"https://auth.x.ai/oauth2/device/code",
	"https://auth.kimi.com",
	"https://auth.meta.com",
	"https://api.meta.ai/muse-code/key",
];

function sourceFilesUnder(dir) {
	const files = [];
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".ts")) files.push(full);
		}
	};
	if (existsSync(dir)) walk(dir);
	return files;
}

check(`标记唯一性：${OAUTH_FLOW_MARKERS.length} 个标记只出现在 auth/oauth/ 下的实现里`, () => {
	const sources = [];
	for (const packageDir of readdirSync(join(repoRoot, "packages"))) {
		sources.push(...sourceFilesUnder(join(repoRoot, "packages", packageDir, "src")));
	}
	const contaminated = [];
	for (const marker of OAUTH_FLOW_MARKERS) {
		for (const file of sources) {
			if (!readFileSync(file, "utf8").includes(marker)) continue;
			if (!relative(repoRoot, file).startsWith("packages/ai/src/auth/oauth/")) contaminated.push(`${marker} → ${relative(repoRoot, file)}`);
		}
	}
	if (contaminated.length > 0) throw new Error(`标记已不再唯一，先换标记：\n  ${contaminated.join("\n  ")}`);
});

function readBundle() {
	const files = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".js")) files.push(full);
		}
	};
	walk(bundleDir);
	return files.map((file) => readFileSync(file, "utf8")).join("\n");
}
const bundleSource = readBundle();
check("bundle 里不含任何 OAuth 登录流特征字符串", () => {
	const found = OAUTH_FLOW_MARKERS.filter((marker) => bundleSource.includes(marker));
	if (found.length > 0) throw new Error(`仍出现：${found.join(", ")}`);
	return `检查了 ${OAUTH_FLOW_MARKERS.length} 个标记`;
});
check("bundle 里包含替身的错误文案（证明替身真的接上了）", () => {
	if (!bundleSource.includes("OAuth login is disabled in this build.")) {
		throw new Error("未找到替身文案：加载器替身没有进入产物");
	}
});

// ── 3 语义断言 ──────────────────────────────────────────────────────────────
console.log("3) 语义断言");
const autoThinkingSource = join(repoRoot, "packages/ai/dist/auto-thinking.js");
check("A 类定制保留：auto-thinking 在 dist 与 bundle 里都在", () => {
	if (!existsSync(autoThinkingSource)) throw new Error("dist 缺少 auto-thinking.js");
	const markers = ["resolveAutoThinkingLevel", "the reasoning effort this coding task needs"];
	const missing = markers.filter((marker) => !bundleSource.includes(marker));
	if (missing.length > 0) throw new Error(`bundle 缺少标记：${missing.join(", ")}`);
	return `bundle 命中 ${markers.length} 个标记`;
});
const loadStub = await import(pathToFileURL(join(repoRoot, "packages/ai/dist/auth/oauth/load.js")).href);
const loadOrig = await import(pathToFileURL(join(repoRoot, "packages/ai/dist/auth/oauth/load.orig.js")).href);

await checkAsync("加载器替身导入即可用，且调用立刻失败", async () => {
	let threw = false;
	try {
		await loadStub.loadAnthropicOAuth();
	} catch (error) {
		threw = /OAuth login is disabled in this build/.test(String(error?.message));
	}
	if (!threw) throw new Error("loadAnthropicOAuth() 没有按预期失败");
});

check("替身的导出集合与上游 load.orig.js 完全一致（漂移探测）", () => {
	const stubKeys = Object.keys(loadStub).sort();
	const origKeys = Object.keys(loadOrig).sort();
	const missing = origKeys.filter((key) => !stubKeys.includes(key));
	const extra = stubKeys.filter((key) => !origKeys.includes(key));
	if (missing.length > 0 || extra.length > 0) {
		throw new Error(`缺失 [${missing.join(", ")}] 多余 [${extra.join(", ")}] —— 上游改了契约，同步更新替身`);
	}
	return `${stubKeys.length} 个导出`;
});

const commandsPath = join(repoRoot, "packages/coding-agent/dist/core/slash-commands.js");
const commands = await import(pathToFileURL(commandsPath).href);
const commandsOrig = await import(pathToFileURL(commandsPath.replace(/\.js$/, ".orig.js")).href);
check("斜杠命令表 = 上游名单 − {login, logout}，且无空洞", () => {
	const names = commands.BUILTIN_SLASH_COMMANDS.map((command) => command?.name);
	if (names.some((name) => name === undefined)) throw new Error("命令表里有 undefined 项");
	const expected = commandsOrig.BUILTIN_SLASH_COMMANDS.map((command) => command.name).filter(
		(name) => name !== "login" && name !== "logout",
	);
	if (JSON.stringify(names) !== JSON.stringify(expected)) {
		throw new Error(`实际 ${names.length} 条与期望 ${expected.length} 条不一致`);
	}
	return `${names.length} 条命令，已移除 login/logout`;
});

// ── 4 冒烟 ──────────────────────────────────────────────────────────────────
console.log("4) 冒烟");
check("构建出的 CLI 能启动（--version）", () => {
	const out = execFileSync(process.execPath, [join(bundleDir, "cli.js"), "--version"], {
		cwd: repoRoot,
		encoding: "utf8",
		timeout: 60_000,
	});
	return String(out).trim().split("\n").pop();
});

if (failures.length > 0) {
	console.error(`\n断言失败 ${failures.length} 项：\n  ${failures.join("\n  ")}`);
	process.exit(1);
}
console.log("\n全部断言通过。");
