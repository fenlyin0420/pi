---
name: pi-fork-ledger
description: pi fork 的分叉台账与删除记录：auto thinking（加性）、OAuth 登录删除、/dementedelves 公告彩蛋删除（均减性）；范式正文见 dev-workflow 技能附带的 FORKING.md
metadata:
  type: project
---

# pi fork 分叉台账

范式正文在 `~/.agents/skills/dev-workflow/FORKING.md`（分支模型、删除边界、同步流程）。本文件只记台账。
`main` 镜像 `upstream/main`，定制全在 `dev`。

## A 类 · 自己实现的上游特性

| 上游 commit | 特性 | 我的实现位置 | 为什么不合 | 上游后续是否跟进 |
|---|---|---|---|---|
| — | 按任务复杂度自动选 reasoning effort（含 KV-cache 稳定性修正） | `packages/ai/src/auto-thinking.ts` + `agent-session.ts` 接线；稳定性：`isThinkingLevelEmbeddedInPrompt`（`models.ts`）判定档位是否经 `chatTemplateKwargs/Args` 的 `thinking.effort` 绑进 prompt 文本——是则档位**会话级锁定**（改档会重写 prompt 前缀、炸掉 KV cache）；否则按 **user turn** 缓存（heuristic 结果也缓存，原实现只缓存 classifier 结果，tool-loop 深度信号会让档位在一轮内漂移） | 上游 `auto` 是单一静态档位；要的是按每次请求的复杂度解析；且用户本地 Qwen（llama.cpp/vLLM，`thinkingFormat: chat-template` + `reasoning_effort: { $var: thinking.effort }`）的模板把档位渲染进 system prompt，逐请求变档=全量 re-prefill | 待观察 |

## C 类 · 纯新增（上游没有这个特性，不需要跟随）

| 特性 | 落点 | 同步上游时的注意点 |
|---|---|---|
| vim mode（`editorMode` 设置，默认 `emacs`） | `packages/tui/src/vim-mode.ts`（全局开关 + `matchesVimListNav`）、`components/editor.ts`（normal/insert 模态状态机）、`tui-alt-screen.ts`（转录滚动）、各选择器显式 opt-in `j`/`k` | `Editor.handleInput` 顶部是 vim 拦截点；`CustomEditor.handleInput` 让 Escape 归 vim 管。改 `Editor` 的 private 成员或 `renderBottomBorder` 时留意这层 |

**为什么 vim 键不进 keybindings 注册表**：`j` 在编辑器里是 motion、在选择器搜索框里是字符，
注册表里一条 `tui.select.down` 没法同时表达两种含义。所以 `matchesVimListNav(data, dir, filterQuery)`
让各选择器显式 opt-in，并把「搜索框已有内容时交还给搜索框」编码进函数签名。
`extension-selector` / `trust-selector` / `first-time-setup` 上游本来就无条件接受 `j`/`k`，保持原样。

## B 类 · 删除的上游功能

| 目标 | 删除方式 | 量化依据 | 复核日期 |
|---|---|---|---|
| 全部内置 OAuth 登录 | 删源码：13 个流实现、`bun-oauth.ts`、`lazyOAuth`、9 个 provider 的 `oauth:` 块、登录 UI 与 `/login` 的 OAuth 分支 | `git log -L` 实测：`interactive-mode.ts` 的 `/login` 派发区 7 次/年、`showOAuthSelector` 11 次/年、`slashCommands.find("login")` 2 次/年 → 全部可接受 | 2026-10-08 |
| `openai-codex` provider（纯 OAuth，无其它认证途径） | 连 provider 工厂 + 预定义模型一起删；保留 `openai-codex-responses` **API**（公共 api id，扩展仍可用） | 该 provider 删掉 OAuth 后 `auth: {}`，模型永不可达 | 2026-10-08 |
| GitHub Copilot 的 OAuth 模型过滤 | 删 `filterModels` 的 oauth 分支 | 无 provider 注册 oauth 后不可达 | 2026-10-08 |
| Radius 的凭据内目录缓存 | 删 `radius-config.ts` 的 `getRadiusModels` / `getRadiusCredentialConfig` 及 `radius.ts` 的 legacy 分支 | 同上；Radius 现在只用 `RADIUS_API_KEY` | 2026-10-08 |
| `/model` 选择器的 "all" 页签（看全量可用目录） | 删 `ModelScope` 类型、`allModels`/`activeModels`/`scopedModelItems`/`scope`/`scopeText`/`scopeHintText` 字段、`sortModels()`、`getScopeText()`、`getScopeHintText()`、`setScope()`、`handleInput` 的 Tab 分支、构造函数的 `scopedModels` 合并逻辑；`ModelItem` 接口一并删（只服务于该页签）。列表只剩 scope 一个来源，空列表改为提示去配 `enabledModels` | `git log -L` 实测 `upstream/main` 近一年：35 行 1 次、53–71 行 12 次、94–112 行 9 次、161–182 行 13 次、267–277 行 6 次、364–373 行 3 次 → 全部在低频区（§2.2 阈值 ≤10 直接删、>40 换落点） | 2026-10-08 |
| `/dementedelves` 公告彩蛋（"pi has joined Earendil" + 上游作者博客链接 + 539 KB 内嵌图） | 删 `components/earendil-announcement.ts`、`assets/clankolas.png`、`interactive-mode.ts` 的 import + `/dementedelves` 派发 + `handleDementedDelves`、`config.ts` 的 `getInteractiveAssetsDir`/`getBundledInteractiveAssetPath`（只服务该功能，未在 `index.ts` 导出）、`copy-assets`/`copy-binary-assets` 里的 png 拷贝段、`build-binaries.sh` 的 assets 拷贝段 | `git log -L` 实测：import 行 1 次/年、`/dementedelves` 派发 3 次/年、`handleDementedDelves` 5 次/年、组件文件整体 4 次/年 → 全部 ≤10。例外：`packages/coding-agent/package.json` 的两条 build script 行是 25 次/年（中频区），冲突时按 §2.2 只做减法、不重排 | 2026-10-11 |

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
