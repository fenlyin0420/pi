# pi fork 项目记忆索引

- [[pi-fork-catalog-drift-offline-hydrate]] — "模型目录漂移"的根因是 gitignored 的 providers/data 过期（不是 models.generated.ts）；models.dev 被墙时用已发布的 @earendil-works/pi-ai tarball 里的 dist/providers/data 离线重建；修好后 pre-commit 全绿、不需要 --no-verify
- [[pi-fork-dist-trim-carrier]] — 产物层裁剪载体 `fork/`：`node fork/build.fork.mjs` 一条命令完成构建+替换汇聚点+AST 重写+剪枝+9 条断言；上游源码零改动；1.0.1 起 OAuth 流确实进 bundle（1.0.0 时不进，结论要随版本重量）
