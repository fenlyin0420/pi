// fork 载体 · S3 mv + wrapper：过滤内置斜杠命令表里的登录入口
//
// 上游源码 packages/coding-agent/src/core/slash-commands.ts 原样保留；本文件在构建时
// 覆盖 dist/core/slash-commands.js（原件改名为 slash-commands.orig.js）。
//
// 不想要的是"数组里的两条"（S3 形状），所以用 wrapper 过滤导出，
// 而不是用 AST 去删数组元素（那会留下悬空逗号，见 dist-trim-cookbook.md）。

import { BUILTIN_SLASH_COMMANDS as UPSTREAM_COMMANDS } from "./slash-commands.orig.js";

const REMOVED_COMMAND_NAMES = new Set(["login", "logout"]);

export const BUILTIN_SLASH_COMMANDS = UPSTREAM_COMMANDS.filter(
	(command) => !REMOVED_COMMAND_NAMES.has(command.name),
);
