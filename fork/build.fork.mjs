#!/usr/bin/env node
// fork 载体 · 构建驱动
//
// 不修改任何上游源码，只在【产物层】施加变换。顺序即正确性：
//   1 上游构建          → dist/ 与 bundle/ 就绪
//   2 hinge / wrapper   → 覆盖 dist 里的汇聚点 .js（上游同名 .d.ts 原样保留，声明面因此永不漂移）
//   3 S4 变换           → 对 dist 的 interactive-mode.js 做 AST 重写（命中数不符即失败）
//   4 重打包            → 用替换后的 dist 重新生成 bundle
//   5 剪枝              → 删除已不可达的产物文件（dist 与 bundle 两侧），并做双向引用检查
//   6 断言              → 见 assertions.mjs
//
// 为什么剪枝在重打包之后：上游 scripts/build-coding-agent-bundle.mjs 把每个 OAuth 流都声明为
// 显式 lazy entry point，并读取 load.ts 源码做一致性校验。所以重打包前这些文件必须存在；
// 打包完成后它们就成了孤儿（唯一入口 load.js 已换成替身），此时再删除即可。

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const forkDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(forkDir, "..");
const AST_GREP = process.env.AST_GREP ?? join(process.env.HOME ?? "", ".pi/agent/npm/node_modules/.bin/ast-grep");
const bundleDir = join(repoRoot, "packages/coding-agent/dist/bundle");

const log = (message) => console.log(`[fork] ${message}`);

function run(command, args) {
	execFileSync(command, args, { cwd: repoRoot, stdio: "inherit" });
}

function dirSize(dir) {
	let total = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
	}
	return total;
}

function listFiles(dir, predicate = () => true) {
	const found = [];
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (predicate(full)) found.push(full);
		}
	};
	if (existsSync(dir)) walk(dir);
	return found;
}

/** 汇聚点替换：只替换 .js，同名 .d.ts 保持上游原版。 */
function swap(targetRel, sourceRel) {
	const target = join(repoRoot, targetRel);
	if (!existsSync(target)) {
		throw new Error(`汇聚点失效：${targetRel} 不存在。上游很可能重命名/移动了它 —— 先更新 fork/ 载体再构建。`);
	}
	const source = join(repoRoot, sourceRel);
	if (!existsSync(source)) throw new Error(`载体文件缺失：${sourceRel}`);
	const original = target.replace(/\.js$/, ".orig.js");
	rmSync(original, { force: true });
	renameSync(target, original);
	copyFileSync(source, target);
	log(`  替换 ${targetRel}`);
}

/** 展开 prune.txt 的 `path/name.*` 形式。 */
function pruneRules() {
	const lines = readFileSync(join(forkDir, "prune.txt"), "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
	return lines.map((pattern) => {
		const dir = join(repoRoot, dirname(pattern));
		const base = pattern.slice(pattern.lastIndexOf("/") + 1);
		return { pattern, dir, prefix: base.replace(/\*$/, ""), chunkName: `${base.replace(/\.\*$/, "")}.js` };
	});
}

function expandDistMatches(rule) {
	if (!existsSync(rule.dir)) return [];
	return readdirSync(rule.dir)
		.filter((entry) => entry.startsWith(rule.prefix))
		.map((entry) => join(rule.dir, entry));
}

/** 静态引用检查：残留产物不得引用已删除的模块（按解析后的真实路径比对，避免同名误判）。 */
function assertNoDanglingReferences(prunedPaths, label) {
	const prunedSet = new Set(prunedPaths.map((file) => resolve(file)));
	const offenders = [];
	const specifierPattern = /(?:from|import\()\s*["']([^"']+)["']/g;
	for (const file of listFiles(label === "bundle" ? bundleDir : join(repoRoot, "packages"), (f) => f.endsWith(".js"))) {
		if (prunedSet.has(resolve(file)) || file.endsWith(".orig.js")) continue;
		if (label === "dist" && file.startsWith(bundleDir)) continue;
		for (const match of readFileSync(file, "utf8").matchAll(specifierPattern)) {
			const specifier = match[1];
			if (!specifier.startsWith(".")) continue;
			if (prunedSet.has(resolve(dirname(file), specifier))) {
				offenders.push(`${relative(repoRoot, file)} → ${specifier}`);
			}
		}
	}
	if (offenders.length > 0) {
		throw new Error(`${label} 剪枝后有 ${offenders.length} 处静态引用悬空：\n  ${offenders.join("\n  ")}`);
	}
}

// ── 1 ───────────────────────────────────────────────────────────────────────
log("1/6 上游构建（npm run build:offline）");
run("npm", ["run", "build:offline"]);

// ── 2 ───────────────────────────────────────────────────────────────────────
log("2/6 替换 hinge / wrapper");
swap("packages/ai/dist/auth/oauth/load.js", "fork/hinge/auth-oauth-load.js");
swap("packages/ai/dist/bun-oauth.js", "fork/hinge/bun-oauth.js");
swap("packages/coding-agent/dist/core/slash-commands.js", "fork/wrapper/slash-commands.js");

// ── 3 ───────────────────────────────────────────────────────────────────────
log("3/6 S4 变换：短路 /login、/logout 派发分支");
if (!existsSync(AST_GREP)) {
	throw new Error(`找不到 ast-grep（${AST_GREP}）。用 AST_GREP=/path/to/ast-grep 指定，或先安装 @ast-grep/cli。`);
}
run(AST_GREP, [
	"scan",
	"--rule",
	join(forkDir, "transforms/login-dispatcher.yml"),
	"--update-all",
	join(repoRoot, "packages/coding-agent/dist/modes/interactive/interactive-mode.js"),
]);

// ── 4 ───────────────────────────────────────────────────────────────────────
log("4/6 重打包 bundle（基于替换后的 dist）");
run("node", ["scripts/build-coding-agent-bundle.mjs"]);
const bundleBefore = dirSize(bundleDir);

// ── 5 ───────────────────────────────────────────────────────────────────────
log("5/6 剪枝 dist + bundle，并做双向引用检查");
const rules = pruneRules();
const prunedDist = [];
for (const rule of rules) {
	const matches = expandDistMatches(rule);
	if (matches.length === 0) {
		throw new Error(`prune.txt 规则 ${rule.pattern} 在 dist 里没有任何匹配 —— 上游产物布局已变，先核对再继续。`);
	}
	prunedDist.push(...matches);
}
for (const file of prunedDist) rmSync(file, { force: true });
assertNoDanglingReferences(prunedDist, "dist");

// 同名的 bundle lazy chunk（上游把它作为 lazy entry 单独产出；loader 已被替换成替身，故已是孤儿）
const prunedBundle = [];
for (const rule of rules) {
	for (const file of listFiles(bundleDir, (f) => f.endsWith(`/${rule.chunkName}`))) {
		prunedBundle.push(file);
		rmSync(file, { force: true });
	}
}
assertNoDanglingReferences(prunedBundle, "bundle");
const bundleAfter = dirSize(bundleDir);

log(
	`  删除 dist ${prunedDist.length} 个文件 / bundle ${prunedBundle.length} 个文件；` +
		`bundle ${(bundleBefore / 1024).toFixed(1)} KiB → ${(bundleAfter / 1024).toFixed(1)} KiB ` +
		`(-${((bundleBefore - bundleAfter) / 1024).toFixed(1)} KiB)`,
);

// ── 6 ───────────────────────────────────────────────────────────────────────
log("6/6 断言");
run("node", [join(forkDir, "assertions.mjs")]);

log("完成：dist 与 bundle 均已按 fork 载体裁剪。");
