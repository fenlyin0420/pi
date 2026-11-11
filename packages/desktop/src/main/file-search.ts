// 项目内文件搜索：给 composer 的 @ 引用补全；跳过依赖和构建目录，结果短时缓存。

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const IGNORED_DIRECTORIES = new Set([
	"node_modules",
	".git",
	"dist",
	"out",
	"build",
	"release",
	".next",
	".turbo",
	".cache",
	"coverage",
	"target",
	"__pycache__",
	".venv",
]);
const MAX_FILES = 20_000;
const CACHE_TTL_MS = 5_000;
const RESULT_LIMIT = 30;

type Cache = { cwd: string; files: string[]; at: number };

let cache: Cache | null = null;

/**
 * 按查询返回最多 30 个候选路径。查询为空时返回少量常见入口文件，方便刚敲 `@` 时就有东西可选。
 * 匹配顺序：文件名前缀 > 路径包含 > 子序列，短路径优先。
 */
export async function searchProjectFiles(cwd: string, query: string): Promise<string[]> {
	const files = await projectFiles(cwd);
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return files.filter((file) => !file.includes("/") || file.split("/").length <= 2).slice(0, RESULT_LIMIT);
	}
	const ranked: { path: string; score: number }[] = [];
	for (const file of files) {
		const score = matchScore(file.toLowerCase(), needle);
		if (score > 0) ranked.push({ path: file, score });
	}
	ranked.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
	return ranked.slice(0, RESULT_LIMIT).map((entry) => entry.path);
}

async function projectFiles(cwd: string): Promise<string[]> {
	if (cache && cache.cwd === cwd && Date.now() - cache.at < CACHE_TTL_MS) return cache.files;
	const files: string[] = [];
	await walk(cwd, cwd, files);
	cache = { cwd, files, at: Date.now() };
	return files;
}

async function walk(root: string, directory: string, files: string[]): Promise<void> {
	if (files.length >= MAX_FILES) return;
	let entries: Dirent<string>[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (files.length >= MAX_FILES) return;
		const name = entry.name;
		if (name.startsWith(".") && name !== ".agents") continue;
		const full = join(directory, name);
		if (entry.isDirectory()) {
			if (IGNORED_DIRECTORIES.has(name)) continue;
			await walk(root, full, files);
		} else if (entry.isFile()) {
			files.push(relative(root, full));
		}
	}
}

function matchScore(path: string, needle: string): number {
	const base = path.slice(path.lastIndexOf("/") + 1);
	if (base.startsWith(needle)) return 100 - base.length / 100;
	if (base.includes(needle)) return 70 - base.length / 100;
	if (path.includes(needle)) return 50 - path.length / 100;
	return subsequenceScore(path, needle);
}

function subsequenceScore(path: string, needle: string): number {
	let index = 0;
	let gaps = 0;
	for (const char of path) {
		if (char === needle[index]) {
			index += 1;
			if (index === needle.length) return 30 - gaps;
		} else if (index > 0) {
			gaps += 1;
		}
	}
	return 0;
}
