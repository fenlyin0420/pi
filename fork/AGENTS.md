# fork 载体规范（产物层裁剪）

本目录是本 fork 全部减性裁剪（B 类定制）的唯一载体。完整决策记录见
[manifest.md](./manifest.md)；机制优先级与技术细节见
`~/.agents/skills/git-fork-upstream-sync/SKILL.md` 与同目录 `dist-trim-cookbook.md`。

## 三条不变量

1. **上游源码永不改。** 所有裁剪只发生在编译/打包流水线上。代价被显式转移：
   从「git 合并冲突（长期税、被动）」变成「构建期报错（本地、立刻、可定位）」。
2. **变换只作用于产物，且每次从干净产物重新生成。** 不做增量、不做就地修补。
3. **验收必须可测量。** 「能解析 / 能启动 / 看上去没有」不算通过。

## 要裁一个上游功能时

**先判定形状，再选刀。** 判据是「这段代码从外面看是什么形状」，不是「它在哪里」。

| 形状 | 刀 | 本仓库实例 |
|---|---|---|
| S1 整目录 / 整文件 | 编译排除（`tsconfig` include/exclude）+ `package.json` files 负向条目 | — |
| S2 import 边：整个家族只经一两个文件进来 | 替换汇聚点（hinge 替身覆盖 dist 里的 `.js`） | `hinge/auth-oauth-load.js`、`hinge/bun-oauth.js` |
| S3 文件里的某个导出项 | mv + wrapper：原件改 `.orig.js`，同名 wrapper 过滤该导出 | `wrapper/slash-commands.js` |
| S4 文件内部的逻辑（分支、语句块） | 产物 AST 重写（ast-grep 按语义锚点），命中数不符即失败 | `transforms/login-dispatcher.yml` |

能归到 S1/S2/S3 就不要用 S4。抗上游漂移能力：S1 ★★★★ / S2 ★★★★★ / S3 ★★★★ / S4 ★★。

**机制优先级**（要求「不执行」用运行时开关，要求「不进产物」才做下面这套）：
运行时开关 → 汇聚点替换 → 构建期 `define` 条件编译 → patch 插入 → **删文件（最后手段）**。

**硬规则：**

- 禁止用整文件删除表达「不需要这个功能」—— git 会报 `modify/delete`，把上游版本写回工作区，
  每次同步都要重删。整模块不想要时用 hinge 换成空实现。
- 禁止用「本地 flag 常量模块 + `if (flag)`」冒充条件编译——那只删调用，模块体照样进产物。
  真要条件编译必须用构建器 `define`，flag 声明放本目录的 `.d.ts`。
- 裁剪结果只存在于工作区等于不存在：一条命令必须能从干净的上游检出重建（`node fork/build.fork.mjs`）。
- 上游新增同类目标而剪枝规则没命中时，**报错是正确行为**：在 `prune.txt` 补一行，不要放宽规则。

## 驱动顺序（顺序即正确性）

`build.fork.mjs` 六步不能重排：

```
1 上游构建 build:offline → 2 hinge/wrapper 覆盖 → 3 S4 ast-grep 重写
→ 4 重打包 bundle → 5 剪枝 dist + bundle → 6 断言
```

剪枝必须在重打包**之后**：上游 `scripts/build-coding-agent-bundle.mjs` 把每个 OAuth 流声明为
显式 `lazyEntryPoints`，并读 `load.ts` 源码做一致性校验，重打包前这些文件必须存在。

**不要直接跑 `npm run build:offline`** —— 那是本仓库的普通开发构建，产出未裁剪的 dist/bundle。

## 断言要求

新增裁剪必须在 `assertions.mjs` 补断言，「不进入产物」要被证明而不是看上去没有：

1. 产物层：`prune.txt` 的规则在 dist 里不再匹配任何文件
2. 反向断言：bundle 里不得出现目标特征串，**且必须出现替身的错误文案**（证明替身真接上了）
   - 标记必须先证明唯一性（本仓库踩过：`auth.openai.com` 也出现在 `node_modules/openai` 的
     workload identity 里，RFC 8628 的 device_code URN 同理 → 会假阳性）
3. 语义断言：替身导出集合 == `.orig.js` 导出集合（探测上游契约漂移）；被裁项恰好等于期望集合且无 `undefined`
4. 冒烟：构建出的 CLI 能启动

替身只覆盖 `.js`，上游同名 `.d.ts` 原样保留 → 声明面永远等于上游，不会出现「类型说能登录、
运行时抛错」。契约漂移靠导出集合断言兜住。

## 每次同步上游后

`git fetch upstream` → 预览 `git log main..upstream/main` / `git diff main upstream/main` →
`main` 合并上游并 push → `dev` 合并 `main` → 然后跑本目录的检查表：

- [ ] manifest 里每条变换的锚点仍命中，命中数 == 期望
- [ ] 跑 `node fork/build.fork.mjs`，全部断言通过
- [ ] 复测收益：裁剪字节归因随上游入口图变化，结论会失效（1.0.0 时 OAuth 流被 bundler 挡住，
      删源码零收益；1.0.1 起它们是显式 lazy entry，才第一次有真实字节收益）
- [ ] prune 清单复核：上游有没有新增同类文件
- [ ] 发现更稳定的边界就把技术升级一格（S4 → 上游抽成模块后变 S2 → 能整目录排除变 S1）。
      同一处反复需要 S4，说明它是应该上游化的边界，给上游提 PR 把它变成 S1/S2。

**任何一把刀失效时构建必须失败**，绝不允许「没匹配到就跳过」。
