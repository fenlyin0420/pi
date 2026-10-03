# fork 载体 · 决策记录

本目录是"不动上游源码、只在产物层裁剪"的全部内容。构建入口：`node fork/build.fork.mjs`。
规范正文见 `~/.agents/skills/git-fork-upstream-sync/SKILL.md`，技术手册见同目录 `dist-trim-cookbook.md`。

复现：`git checkout dev && npm install --ignore-scripts && node fork/build.fork.mjs`

---

## 1. 本次裁剪的验收标准

| 项 | 值 |
|---|---|
| 目标 | 去掉**所有 OAuth 登录功能**；保留 auto-thinking |
| 验收（可测量） | ① OAuth 流实现不在 `packages/*/dist` 且不在 `dist/bundle`；② `/login`、`/logout` 不在命令表；③ bundle 中不出现任何"只在 auth/oauth/ 下出现过的"特征串；④ CLI 能启动 |
| 口径 | 分发体积（dist + bundle 全量） |
| 约束 | 上游源码零改动（因此 `git merge/rebase upstream` 永不冲突） |

---

## 2. 逐项决策

| # | 目标 | 形状 | 刀 | 锚点 / 落点 | 期望命中 | 断言 | 对账点（上游） |
|---|---|---|---|---|---|---|---|
| 1 | 所有 OAuth 登录流入口失效 | S2 import 边 | 替换汇聚点 | `packages/ai/dist/auth/oauth/load.js` ← `fork/hinge/auth-oauth-load.js` | 10 个导出逐一对应 | 导出集合与 `load.orig.js` 相等；调用立即失败 | `packages/ai/src/auth/oauth/load.ts` → `load*OAuth` / `registerBundledOAuthFlowLoaders` |
| 2 | 流实现不再被静态引用 | S2 import 边 | 替换汇聚点 | `packages/ai/dist/bun-oauth.js` ← `fork/hinge/bun-oauth.js` | 1 个导出 | 剪枝引用检查通过 | `packages/ai/src/bun-oauth.ts` → `registerBunOAuthFlows` |
| 3 | 流实现从产物消失 | S1/S2 | 剪枝 | `fork/prune.txt`（12 条 × 4 个产物文件 = 48 个）+ bundle 同名 lazy chunk 9 个 | 每条 ≥1 匹配，否则构建失败 | 无残留 + 无悬空静态引用 | `packages/ai/src/auth/oauth/<flow>.ts` |
| 4 | `/login`、`/logout` 从命令表消失 | S3 导出项 | mv + wrapper | `dist/core/slash-commands.js` ← `fork/wrapper/slash-commands.js` | 上游名单 − 2 | 结果恰好等于「上游名单 − {login, logout}」且无 undefined | `core/slash-commands.ts` → `BUILTIN_SLASH_COMMANDS` |
| 5 | 硬编码的 `/login`、`/logout` 输入分支失效 | S4 文件内部 | 产物 AST 重写 | `fork/transforms/login-dispatcher.yml`，作用于 `dist/modes/interactive/interactive-mode.js` | 2 处 | ast-grep 命中数不符即失败；bundle 里不得再出现该分支 | `modes/interactive/interactive-mode.ts` 的 submit 派发 |
| 6 | auto-thinking 必须保留（A 类） | — | 不动 | dev 上的定制提交 | — | dist 有 `auto-thinking.js`，bundle 含 `resolveAutoThinkingLevel` 与分类器 prompt | — |

### 为什么只替换 `.js`，不替换同名 `.d.ts`

替换后的 `load.js`、`bun-oauth.js`、`slash-commands.js` 都保留了上游同名 `.d.ts`，
即**声明面永远等于上游**：类型不会漂移，也不会出现"类型说能登录、运行时抛错"的不一致。
契约漂移靠两条断言兜住：导出集合相等（漂移探测）、命令表集合相等。

---

## 3. 实测结果

| 项 | 结果 |
|---|---|
| dist | 删除 48 个产物文件（OAuth 流实现及其 .d.ts/.map，共 12 个模块） |
| bundle | 删除 9 个 lazy chunk；**8828.4 KiB → 8699.2 KiB（−129.2 KiB）** |
| 断言 | 全部通过（含 8 个 OAuth 特征串反向断言 + 标记唯一性自检） |
| 上游校验套件 | `npm run check` 全绿（由 pre-commit 钩子执行：biome / pinned-deps / runtime-deps / ts-imports / entry-graphs / install-lock / `tsc --noEmit` / browser-smoke） |
| 幂等 | 连续两次完整构建结果逐字节一致 |

### 一条与 1.0.0 时代相反的结论

1.0.0 时 OAuth 流靠"变量 specifier 动态 import"被挡在打包器之外，**删源码对产物零收益**。
1.0.1 上游改成把每个流声明为显式 lazy entry point（`scripts/build-coding-agent-bundle.mjs`
的 `lazyEntryPoints`，并读 `load.ts` 源码做一致性校验），于是它们**真的会作为独立 chunk 进 bundle**。
所以对这个版本，"不打包进去"第一次有了真实字节收益（−129 KiB），而"改源码删掉"依然是错的选择。

---

## 4. 未做（明确记录，避免以为已经做了）

| 项 | 现状 | 为什么没做 |
|---|---|---|
| `interactive-mode.js` 里的 `showOAuthSelector`、`handleLoginCommand` 及 UI 组件文件（login-dialog / oauth-selector / radius-login-selector） | 仍在 dist；输入分支已短路（第 5 项），故不可达 | 属于 S4 形状且无导出边界，逐个 AST 改写收益低风险高；已由"入口短路 + 流替身"保证不可用 |
| 各 provider 的 `auth.oauth` 声明（40 个 provider 文件） | 保留 | 声明本身字节极小；登录路径已被第 1 项切断，登录必然失败 |
| MCP 自己的 OAuth（`packages/mcp/dist/oauth/*`，用于 MCP 服务器鉴权） | 保留 | 与"模型供应商登录"不是同一件事；原 strip 也未涉及 |
| `node_modules/openai` 的 workload identity federation | 保留 | 第三方 SDK 内部实现，不是 pi 的登录入口；也解释了为什么标记里不能放 `auth.openai.com` |

---

## 5. 上游漂移时会发生什么

| 上游动作 | 表现 | 处理 |
|---|---|---|
| 重命名/移动 `auth/oauth/load.ts`、`bun-oauth.ts`、`slash-commands.ts` | 驱动第 2 步立刻报"汇聚点失效" | 更新 `fork/` 里对应的落点 |
| 新增 OAuth 流（如 `grok.ts`） | 剪枝规则不匹配 → 第 5 步报错（`prune.txt` 规则无匹配 / bundle 反向断言失败） | 在 `prune.txt` 补一行 |
| 改 `load.ts` 的导出集合 | 断言"导出集合相等"失败 | 同步更新替身 |
| 改 `/login` 派发写法 | ast-grep 命中数 ≠ 2 → 第 3 步失败 | 更新 `fork/transforms/login-dispatcher.yml` 的锚点 |
| 把 OAuth 流改回 bundler-opaque 懒加载 | 第 5 步 bundle 侧删不到 chunk（不报错，正常） | 反向断言仍会验证"不在产物里"，无需动作 |
