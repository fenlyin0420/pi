---
name: pi-fork-ledger
description: pi fork 的分叉台账与删除记录：auto thinking（加性）、OAuth 登录删除（减性，2026-10-08 实施）；范式正文见仓库根 FORKING.md
metadata:
  type: project
---

# pi fork 分叉台账

范式正文在**仓库内** `FORKING.md`（分支模型、删除边界、同步流程）。本文件只记台账。
`main` 镜像 `upstream/main`，定制全在 `dev`。

## A 类 · 自己实现的上游特性

| 上游 commit | 特性 | 我的实现位置 | 为什么不合 | 上游后续是否跟进 |
|---|---|---|---|---|
| — | 按任务复杂度自动选 reasoning effort | `packages/ai/src/auto-thinking.ts` + `agent-session.ts` 接线 | 上游 `auto` 是单一静态档位；要的是按每次请求的复杂度解析 | 待观察 |

## B 类 · 删除的上游功能

| 目标 | 删除方式 | 量化依据 | 复核日期 |
|---|---|---|---|
| 全部内置 OAuth 登录 | 删源码：13 个流实现、`bun-oauth.ts`、`lazyOAuth`、9 个 provider 的 `oauth:` 块、登录 UI 与 `/login` 的 OAuth 分支 | `git log -L` 实测：`interactive-mode.ts` 的 `/login` 派发区 7 次/年、`showOAuthSelector` 11 次/年、`slashCommands.find("login")` 2 次/年 → 全部可接受 | 2026-10-08 |
| `openai-codex` provider（纯 OAuth，无其它认证途径） | 连 provider 工厂 + 预定义模型一起删；保留 `openai-codex-responses` **API**（公共 api id，扩展仍可用） | 该 provider 删掉 OAuth 后 `auth: {}`，模型永不可达 | 2026-10-08 |
| GitHub Copilot 的 OAuth 模型过滤 | 删 `filterModels` 的 oauth 分支 | 无 provider 注册 oauth 后不可达 | 2026-10-08 |
| Radius 的凭据内目录缓存 | 删 `radius-config.ts` 的 `getRadiusModels` / `getRadiusCredentialConfig` 及 `radius.ts` 的 legacy 分支 | 同上；Radius 现在只用 `RADIUS_API_KEY` | 2026-10-08 |
| `/model` 选择器的 "all" 页签（看全量可用目录） | 删 `ModelScope` 类型、`allModels`/`activeModels`/`scopedModelItems`/`scope`/`scopeText`/`scopeHintText` 字段、`sortModels()`、`getScopeText()`、`getScopeHintText()`、`setScope()`、`handleInput` 的 Tab 分支、构造函数的 `scopedModels` 合并逻辑；`ModelItem` 接口一并删（只服务于该页签）。列表只剩 scope 一个来源，空列表改为提示去配 `enabledModels` | `git log -L` 实测 `upstream/main` 近一年：35 行 1 次、53–71 行 12 次、94–112 行 9 次、161–182 行 13 次、267–277 行 6 次、364–373 行 3 次 → 全部在低频区（§2.2 阈值 ≤10 直接删、>40 换落点） | 2026-10-08 |

**保留的**：OAuth 类型面（`OAuthAuth`/`OAuthCredential`/`AuthType`/`Credential` 的 oauth 分支）、
`auth.json` 的 oauth 条目解析、扩展 `defineProvider` 的 `oauth?:` 字段、MCP 自身的 OAuth
（`packages/mcp/src/oauth/`）、`@pi-ai/oauth` barrel。理由：类型擦除为 0 字节，删了不省体积，
却会破坏第三方扩展编译并让旧凭据文件变非法。

`tui.input.tab` 这个 keybinding 本身**保留**：删页签只删 `model-selector.ts` 里的消费点，
`config-selector.ts`、`session-selector.ts`、`tui/components/editor.ts`（补全）还在用。

## 已知的既有失败（与定制无关）

- `packages/ai/test/providers.test.ts` Kimi K3 定价、`supports-xhigh.test.ts` Claude Sonnet 5.5
  定价 —— 重跑 `hydrate:model-data` 拉取线上目录后暴露的**目录漂移**。目录数据是 gitignore 的
  生成物，改测试里的期望价等于把今天的目录焊死进测试，**不要这样修**。
- `tools.test.ts` 的 grep/find 与 `3302`/`3303` 回归 —— `fd`/`rg` 子进程测试在 `./test.sh`
  全并行下抖动；单独跑全绿。
- `auth-storage.test.ts` 的 reload 合并 —— 同样是并行下的偶发。
- `package-command-paths.test.ts` 的 "toggles built-in extensions in config global mode" 与
  "cycles project built-in extension overrides in config local mode" —— `/config` 内置扩展
  toggle 后 `settingsManager.get*Settings().extensions` 仍是 `undefined`。已用 `git worktree`
  在 HEAD 上复现同样失败，与模型选择器无关。

## 关联

- [[pi-fork-catalog-drift-offline-hydrate]] —— 目录漂移的根因与离线重建方法
