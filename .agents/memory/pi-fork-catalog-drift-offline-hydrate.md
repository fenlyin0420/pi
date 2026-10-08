---
name: pi-fork-catalog-drift-offline-hydrate
description: pi fork 的"模型目录漂移"根因是 gitignored 的 providers/data 过期（不是 models.generated.ts）；models.dev 被墙时可用已发布的 @earendil-works/pi-ai tarball 里的 dist/providers/data 离线重建，修好后 pre-commit 全绿、不需要 --no-verify
metadata:
  type: project
---

# pi fork 的模型目录漂移：根因与离线修法

`~/Documents/GitHub/pi`（fork，origin=fenlyin0420/pi，upstream=earendil-works/pi）。

## 症状（2026-10-02 记录，已修正）

`tsc --noEmit` 报约 40 个错（`openai-codex.models.ts` 的 `Type 'unknown' does not satisfy the
constraint 'ModelGroups'`、各测试里 `getModel("gpt-5.5")` 落到 `never`），20 个测试失败，
husky pre-commit 全量 `npm run check` 必挂 → 当时靠 `--no-verify` 绕。

## 真正的根因

**不是 `models.generated.ts`（它被跟踪且一直是对的），而是被 gitignore 的生成物
`packages/ai/src/providers/data/*.json` 过期**：它由 `npm run hydrate:model-data`
（`scripts/generate-models.ts --data-only`）生成，新 clone / 跨上游大版本后必须重建。
上游 1.0.1 的目录是 42 个 provider，旧数据是 41 个且结构哈希不同 → 类型全崩。

## 离线重建（models.dev 不可达时）

`hydrate:model-data` 会去连 `models.dev`（本机常被墙：`ECONNRESET`）。绕过办法：
已发布的 npm 包 `@earendil-works/pi-ai` 的 `dist/` 里就带着同一份 data（`files: ["dist"]`）。

```bash
cd /tmp && npm pack @earendil-works/pi-ai@1.0.1        # registry 已指向 registry.npmmirror.com
tar xzf earendil-works-pi-ai-1.0.1.tgz
rm -f  ~/Documents/GitHub/pi/packages/ai/src/providers/data/*.json
cp package/dist/providers/data/*.json package/dist/providers/data/.manifest.json \
   ~/Documents/GitHub/pi/packages/ai/src/providers/data/
cd ~/Documents/GitHub/pi && npm run check:model-data   # → "Generated model data is valid."
```

之后 `tsc --noEmit` 从 42 个错降到 0，pre-commit hook（biome / 依赖 / 入口图 / tsc /
browser-smoke）**全绿，不需要 `--no-verify`**。
注意版本要对齐：取与当前 `main` 同一发布版本的 tarball。

## 关联

- [[pi-fork-dist-trim-carrier]] — 同一个 fork 的裁剪载体
- 分支规范见全局技能 `git-fork-upstream-sync`
