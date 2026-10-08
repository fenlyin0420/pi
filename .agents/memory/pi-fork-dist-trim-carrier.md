---
name: pi-fork-dist-trim-carrier
description: pi fork 的产物层裁剪载体 fork/ 的布局与用法：node fork/build.fork.mjs 一条命令完成上游构建+替换汇聚点+AST 重写+剪枝+断言；上游源码零改动故同步永不冲突；含 1.0.1 起 OAuth 流确实会进 bundle 的事实
metadata:
  type: project
---

# pi fork 的 dist 裁剪载体（fork/）

`~/Documents/GitHub/pi`。规范正文见 `~/.agents/skills/git-fork-upstream-sync/SKILL.md`，
技术手册见同目录 `dist-trim-cookbook.md`。

## 布局与用法

```
fork/
  build.fork.mjs                  驱动：上游构建 → 替换 hinge/wrapper → S4 变换 → 重打包 → 剪枝 → 断言
  assertions.mjs                  9 条断言（反向/语义/漂移探测/保留/冒烟）
  prune.txt                       dist 剪枝清单（path/name.* 形式）
  hinge/auth-oauth-load.js        S2 替身：OAuth 流加载器（唯一静态入口）
  hinge/bun-oauth.js              S2 替身：Bun 侧 OAuth 注册（流的唯一静态引用者）
  wrapper/slash-commands.js       S3 wrapper：过滤命令表里的 login/logout
  transforms/login-dispatcher.yml S4：短路 interactive-mode 里 /login /logout 派发
  manifest.md                     决策记录（逐项 形状/刀/锚点/期望命中/断言/对账点）
```

- 构建：`npm install --ignore-scripts && node fork/build.fork.mjs`（**不要**直接用
  `npm run build:offline`，那会得到未裁剪的 dist）
- 替换只针对 `.js`，上游同名 `.d.ts` 原样保留 → 声明面永不漂移。
- 上游源码零改动 → `git merge/rebase upstream` 永不冲突；代价转移到构建期报错。

## 事实（2026-10-04，upstream 1.0.1）

- **1.0.1 起 OAuth 流真的会进 bundle**：上游把每个流声明为显式 lazy entry point
  （`scripts/build-coding-agent-bundle.mjs` 的 `lazyEntryPoints`，并读 `load.ts` 源码做一致性
  校验）。1.0.0 时它们是 bundler-opaque 的，删了零收益 —— 结论随上游版本变，**每次升级后重量**。
- 裁剪实测：dist 删 48 个文件、bundle 删 9 个 lazy chunk，**bundle 8828.4 → 8699.2 KiB**。
- 剪枝必须放在**重打包之后**：上游脚本的 lazy entry 与一致性校验要求这些文件先存在。
- 断言标记必须**先证明唯一**：`auth.openai.com` 不是流独有（`node_modules/openai` 的
  workload identity 里也有），RFC 8628 的 device_code URN 同样被第三方 SDK 使用 → 会假阳性。
- ast-grep 在本机是 `~/.pi/agent/npm/node_modules/.bin/ast-grep`（`/usr/bin/sg` 是 shadow 的
  `sg`，不是它）；驱动支持 `AST_GREP=` 覆盖。

## 关联

- [[pi-fork-catalog-drift-offline-hydrate]] — 构建前必须先让模型目录数据是新的
