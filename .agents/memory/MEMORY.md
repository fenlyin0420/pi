# pi fork 项目记忆索引

- [[pi-fork-catalog-drift-offline-hydrate]] — "模型目录漂移"的根因是 gitignored 的 providers/data 过期（不是 models.generated.ts）；models.dev 被墙时用已发布的 @earendil-works/pi-ai tarball 里的 dist/providers/data 离线重建；修好后 pre-commit 全绿、不需要 --no-verify
- [[pi-fork-ledger]] — 分叉台账：auto thinking（加性）与 OAuth 登录删除（减性，含 `git log -L` 量化依据）；范式正文在 `~/.agents/skills/dev-workflow/FORKING.md`，`fork/` 载体方案已废弃
