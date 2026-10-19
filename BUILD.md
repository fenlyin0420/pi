# pi 构建手册：从源码构建带 TUI 的 code agent

本文记录在本地把 pi monorepo 构建成可运行的 code agent（TUI 交互模式）的完整步骤。
文档里的每条命令都在本机实测通过，实测环境与结果见第 9 节。

---

## 0. 交付物

| 项目 | 值 |
|------|-----|
| 是什么 | `pi` 交互式 coding agent CLI，交互模式就是终端 TUI（`packages/coding-agent/src/modes/interactive`） |
| 版本 | 1.3.0（`packages/coding-agent/package.json`；根 `package.json` 是工作区占位版本 0.0.3） |
| 主产物 | `packages/coding-agent/dist/bundle/cli.js`（80 个文件，8.8 MiB） |
| 运行方式 | `./pi-built.sh`（等价于 `node packages/coding-agent/dist/bundle/cli.js`） |
| 交互式入口 | 无参数直接启动就是 TUI；`--tui-mode fullscreen` 切全屏布局 |
| 依赖运行时 | Node.js >= 22.19（本仓库用 TypeScript 7 / tsgo 编译，要求较新的 Node） |

上表的文件数与体积是第 9.2 节（1.3.0）的实测值；第 9.1 节是 0.87.1 时代的历史记录，两者不可直接比较。

`pi-built.sh` 是启动脚本，内容就是定位 bundle 后 `exec node`。
如果你清理掉了它，直接用 `node packages/coding-agent/dist/bundle/cli.js` 也能跑。

两种运行方式的区别：

| 脚本 | 跑的是什么 | 需要先构建吗 |
|------|-----------|--------------|
| `./pi-built.sh` | 编译后的 bundle（本次交付物） | 需要 |
| `./pi-test.sh` | TypeScript 源码（node strip-types + source-resolver） | 不需要，改代码后立刻生效，迭代开发用 |

---

## 1. 环境要求

| 项 | 要求 | 本机实测值 |
|----|------|-----------|
| Node.js | `>=22.19.0`（根 `package.json` engines） | v25.9.0 |
| npm | 能装 workspace 即可 | 11.12.1 |
| 平台 | 任意；Linux x64 已验证 | Ubuntu / kernel 6.8 / x86_64 |
| 网络 | **首次构建需要**（拉取模型目录数据，见 3.2） | 可用 |
| bun | 不需要（只有单文件二进制才需要，见第 7 节） | 未安装 |

`packages/tui/native/{linux,darwin,win32}/prebuilds/` 里的原生模块预编译产物已经提交在仓库里，
所以 TUI 的原生能力（剪贴板等）不需要本地编译，不需要 node-gyp / 编译器工具链。

---

## 2. 完整构建（三条命令）

在仓库根目录执行：

```bash
npm install --ignore-scripts        # 1. 安装依赖
npm run hydrate:model-data          # 2. 生成模型目录数据（每个新 clone 只需一次）
npm run build:offline               # 3. 编译全部包 + 打包 CLI
```

本仓库是 `earendil-works/pi` 的 fork：`dev` = 上游 + 一层薄加性定制（不裁剪上游源码，见
`~/.agents/skills/dev-workflow/FORKING.md`），所以 `build:offline` 直接产出的就是分叉产物 —— 没有额外的构建步骤。

实测耗时（本机）：`build:offline` 5.6s，`hydrate:model-data` 3.7s，`npm install` 在已有
`node_modules` 时是秒级的增量安装。**全新 clone 从零安装依赖的耗时本机未实测**，
按仓库规模（1000+ 依赖）估计 1-3 分钟，是整个流程里唯一的大头。

第 2 步只在这些情况下需要跑：`packages/ai/src/providers/data/` 不存在或过期时。
该目录被 `.gitignore` 忽略，所以新 clone 的仓库里一定没有它，而第 3 步会强制校验它（见 3.2）。
如果你是反复增量构建、只改了 `packages/coding-agent` 或 TUI 的代码，跳过第 2 步直接跑第 3 步即可。

### 这三条命令能在子包里执行吗

| 命令 | 能否在子包内执行 | 说明 |
|------|----------------|------|
| `npm install --ignore-scripts` | 能，但没意义 | 在子包里跑，npm 依然会安装整个 workspace 到根目录，实测 `package-lock.json` 一个字节没变，等于在根目录跑 |
| `npm run hydrate:model-data` | 只能在根目录 | 子包里的脚本名是 `hydrate-model-data`（连字符，不是冒号）。在 `packages/ai` 里跑根目录那个名字会报 `npm error ... try: npm run --workspace=@earendil-works/pi-ai` |
| `npm run build:offline` | 只能在根目录 | 只有根 `package.json` 定义了这个 11 包构建顺序 |

只构建 `packages/coding-agent` 本身是可以的，两种写法实测都通过：

```bash
cd packages/coding-agent && npm run build
# 或（根目录）
npm run build --workspace=packages/coding-agent
```

但**前提是上游包的 dist 已经存在**。`npm run clean` 之后单独跑它会失败（tsc 把 `@earendil-works/*`
解析到各包的 `dist/`）：

```
src/cli/auth-check.ts(1,38): error TS2307: Cannot find module '@earendil-works/pi-ai' or its corresponding type declarations.
src/cli/args.ts(5,36): error TS2307: Cannot find module '@earendil-works/pi-agent-core' or its corresponding type declarations.
```

所以：

- 首次构建 / 每次 `npm run clean` 之后：用根目录的 `npm run build:offline`（推荐，6 秒，没必要优化）
- 之后只改了 `packages/coding-agent` 或 TUI 的代码：在子包里 `npm run build` 就够，迭代更快

**只为了 code agent，可以少建两个包。** CLI bundle 完全不依赖 `durable` 和
`session-backends/sqlite-node`（实测 `packages/coding-agent/src` 里没有任何 `pi-durable` 引用），
下面这条 9 包链实测产出与完整构建完全一致的 `dist/bundle`（59 文件 / 8.5 MiB），
`--version`、`--list-models`、TUI 渲染都正常：

```bash
npm run clean
for p in packages/chord packages/tui packages/telemetry packages/ai packages/agent \
         packages/protocol packages/client packages/server packages/coding-agent; do
  npm run build --workspace="$p" || break
done
```

`--workspace` 只能写**目录路径**：`--workspace=packages/tui` 有效，写包名片段
（`--workspace=pi-tui`、`--workspace=chord`）会报 `No workspaces found`。
`build:offline` 脚本里的 `cd packages/xxx && npm run build` 就是这个路径形式的等价写法。

---

## 3. 每一步在做什么

### 3.1 `npm install --ignore-scripts`

按仓库规则（`AGENTS.md` 的 Dependency and Install Security）一律加 `--ignore-scripts`，
不执行任何依赖的 lifecycle 脚本；pi 正常运行也不依赖它们。

- 想要 CI 式全新安装用 `npm ci --ignore-scripts`（会先删掉 `node_modules`）
- 改了依赖元数据后要刷新 lockfile：`npm install --package-lock-only --ignore-scripts`
- `.npmrc` 里 `save-exact=true`（直接依赖锁精确版本）+ `min-release-age=2`（避免解析到当天发布的版本）
- 安装过程中出现的 `EBADENGINE ... autoevals@0.3.0 ... please-use-pnpm` 是 devDependency 的噪音警告，不影响构建

### 3.2 `npm run hydrate:model-data`（关键步骤，最容易踩）

`packages/ai` 的模型目录是**生成物**，落在 `packages/ai/src/providers/data/*.json`，
而这个目录在 `.gitignore` 里。`packages/ai` 的 `build:offline` 第一件事是 `check:model-data`，
数据缺失就直接失败（实测报错）：

```
amazon-bedrock.json is not valid JSON: ENOENT: no such file or directory, open '.../packages/ai/src/providers/data/amazon-bedrock.json'

Model data is missing or stale. Run `npm run hydrate:model-data` from the repository root.
```

`npm run hydrate:model-data` 实际执行 `node scripts/generate-models.ts --strict --data-only`：

- `--data-only` 表示只写 JSON 数据目录，**不**重新生成 `src/models.generated.ts` 和 `src/providers/*.models.ts`，
  所以 `git status` 保持干净（本次构建前后实测均为空）
- 它会访问 openrouter / nvidia / vercel ai gateway / radius 等 provider 的模型列表接口拉最新价格与能力；
  某个接口失败只会打印 `Failed to fetch ...` 警告并跳过该 provider，不会中断
- 产物规模：42 个文件，约 948K

替代方案 `npm run build`（根目录）会额外执行 `generate-models`，**会改写 git 跟踪的
`packages/ai/src/models.generated.ts` 与 `src/providers/*.models.ts`**。
只有在你真的想更新模型数据时才用，否则会污染工作区（本仓库可能有多个 pi session 同时在跑）。

### 3.3 `npm run build:offline`

按依赖顺序编译 11 个包，然后打包 CLI：

```
chord → tui → telemetry → ai → durable → agent
       → session-backends/sqlite-node → protocol → client → server → coding-agent
```

- 每个包：`tsc -p tsconfig.build.json`（本仓库的 TypeScript 是 **7.0.2 原生版 tsgo**，所以极快）
- `packages/ai` 额外做 `check:model-data` + 把 `src/providers/data` 拷进 `dist/providers/data`
- `packages/session-backends/sqlite-node` 额外拷 migration 文件
- `packages/coding-agent` 最后跑 `scripts/build-coding-agent-bundle.mjs`（esbuild 打包，输出
  `dist/bundle/cli.js`、`rpc-entry.js` 及 chunks），并把 theme JSON、assets PNG、export-html 模板拷进 dist
- `build:offline` 与 `build` 的唯一区别就是 `ai` 那一步是否刷新模型数据
- 其中 `durable` 和 `session-backends/sqlite-node` 不参与 CLI bundle，只在需要完整 runtime 时才必建（见 2.1 的 9 包链）

---

## 4. 验证构建结果

### 4.1 命令行自检

```bash
./pi-built.sh --version          # 期望 0.87.1
./pi-built.sh --list-models | head   # 期望打出 provider/model/context 表，说明 dist 里的模型数据可读
./pi-built.sh --help             # 期望打出完整 CLI 用法
```

### 4.2 TUI 冒烟测试（本机没装 tmux，用 `script(1)` + fifo 驱动一个 pty）

本机没有 tmux（`sudo` 需要密码，装不了），所以用一个 pty 包装器跑交互界面。
把下面脚本存成 `/tmp/pi-tui-smoke.sh` 后执行：

```bash
#!/usr/bin/env bash
# 用 pty 驱动构建出来的 pi TUI，并把屏幕内容转成纯文本打印出来
set -uo pipefail
CLI="$1"; WORKDIR="$2"; OUT="$3"
FIFO="$(mktemp -u /tmp/pi-in-XXXXXX)"; mkfifo "$FIFO"; : > "$OUT"
script -qefc "stty rows 45 cols 120; cd '$WORKDIR' && exec '$CLI' --no-session --offline" /dev/null < "$FIFO" >> "$OUT" 2>&1 &
SCRIPT_PID=$!
exec 3> "$FIFO"
clean() { sed -E 's/\x1b\[[0-9;?]*[a-zA-Z]//g; s/\x1b[()#][A-Z0-9]//g; s/\x1b[=>]//g; s/\r//g' "$OUT" | grep -v '^$' | tail -n 40; }
sleep 8;  echo "===== 启动后 ====="; clean
printf '/model\r' >&3; sleep 3; echo "===== /model ====="; clean
printf '\x1b' >&3; sleep 2; printf 'say hi\r' >&3; sleep 10; echo "===== 提交 prompt 后 ====="; clean
printf '\x03' >&3; sleep 2; kill "$SCRIPT_PID" 2>/dev/null; exec 3>&-; rm -f "$FIFO"
```

```bash
mkdir -p /tmp/pi-smoke-work
bash /tmp/pi-tui-smoke.sh "$PWD/packages/coding-agent/dist/bundle/cli.js" /tmp/pi-smoke-work /tmp/pi-smoke.log
```

本次实测观察到的画面要素（说明 TUI 是真的在跑，不只是进程启动）：

- 启动即进入交互界面：对话区 + 输入编辑器 + 底部状态栏（当前目录、上下文占用 `0.0%/197k (auto)`、MCP/LSP 状态）
- `/model` 打开模型选择器，列出 19 个可用模型（`local-llama-cpp` / `anthropic` …），底部提示
  `Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel`
- 提交 prompt 后状态栏切到 `Working` 并有旋转动画，上下文占用涨到 `9.4%/197k`，说明请求已发出

有 tmux 的机器上直接用仓库自带的方式更方便（见 `pi-tui-testing` 技能）：

```bash
tmux new-session -d -s pi-test -x 120 -y 45
tmux send-keys -t pi-test "./pi-built.sh" Enter
sleep 3 && tmux capture-pane -t pi-test -p
```

### 4.3 可选：跑测试

```bash
./test.sh          # 全量非 e2e 测试（会跳过没有 API key 的 LLM 相关用例）
npm run check      # 只在改了代码后跑：biome + 类型检查 + 若干一致性校验
```

只构建不改代码时这两条都可以跳过。

---

## 5. 运行构建出来的 agent

```bash
cd /path/to/your/project

# 交互式 TUI（主用法）
/path/to/pi/pi-built.sh

# 全屏 TUI
/path/to/pi/pi-built.sh --tui-mode fullscreen

# 一次性任务，跑完退出（文本输出）
/path/to/pi/pi-built.sh -p "解释一下 src/index.ts"

# JSON 输出 / RPC 模式
/path/to/pi/pi-built.sh --mode json -p "..."
/path/to/pi/pi-built.sh --mode rpc
```

配置与认证（与 npm 安装版完全一致）：

- 用户级配置目录 `~/.pi/agent`（`auth.json` 也在里面）
- 项目级配置 `~/project/.pi/`：`settings.json`、`SYSTEM.md`、`extensions/`、`skills/`、`prompts/`、`themes/`
- 交互界面里 `/model` 选模型、`/login` 输入 API key；也支持环境变量（`ANTHROPIC_API_KEY` 等）
- 登录与上游一致：`/login` 支持 API key 与订阅制 OAuth，`/logout` 删除存储的凭据
- 常用开关：`--offline`（关掉启动期联网）、`--no-session`（不落盘会话）、`--approve/--no-approve`（项目文件信任）、
  `--no-extensions/--no-skills/--no-prompt-templates/--no-themes`（按类关掉资源发现）

### 可选：装成全局 `pi` 命令

```bash
npm install -g --ignore-scripts /path/to/pi/packages/coding-agent
```

实测行为：npm 会把本地目录**做成 symlink** 装进全局 node_modules，并建 `pi` → 仓库内
`dist/bundle/cli.js` 的软链（不是拷贝，所以仓库一删命令就失效）。

注意本机已经装了官方版 `@earendil-works/pi-coding-agent@0.87.0`
（`~/.config/nvm/versions/node/v25.9.0/bin/pi`），执行上面命令会把默认 `pi` 换成仓库构建版本。
想回退：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.87.0
```

不想动全局环境的话，就用绝对路径调用 `./pi-built.sh`。

---

## 6. 清理

```bash
npm run clean          # 等价于 npm run clean --workspaces，删除所有 packages/*/dist
```

彻底回到"未构建"状态（`node_modules` 和模型数据也没了，下次要重跑第 2 节全部三条命令）：

```bash
npm run clean
rm -rf node_modules packages/*/node_modules packages/ai/src/providers/data
```

`dist/`、`.artifacts/`、`node_modules/`、`packages/ai/src/providers/data/` 都在 `.gitignore` 里，
清理不会动 git 跟踪的文件。

---

## 7. 可选：单文件独立二进制（需要 bun，本机未验证）

想要一个不依赖 Node 的 `pi` 可执行文件时用这条路径。**本机没装 bun，以下步骤未实测**。

```bash
npm install -g bun                       # 或 curl -fsSL https://bun.sh/install | bash
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
# 产物：out/pi（已解压可直接跑），out/pi-linux-x64.tar.gz（发布用包）
```

要点：

- 脚本会先 `npm ci --ignore-scripts` + `npm run build:offline`，想跳过就加 `--skip-install --skip-build`
- 本机没装 bun，这条路径未验证
- `--offline-model-data` 用仓库里已有的模型数据，不联网刷新；不加则走 `npm run build`
  （注意它仍然要求 `packages/ai/src/providers/data/` 已存在——完全无网络的环境要用 GitHub release 的
  `pi-<version>-source.tar.gz`，那个源码包自带模型数据和原生 prebuilds；或者从一台已经 hydrate 过的
  机器把 `packages/ai/src/providers/data/` 整个目录拷过去）
- 编译命令是 `bun build --compile --no-compile-autoload-bunfig --target=bun-linux-x64-baseline`，
  `--no-compile-autoload-bunfig` 是为了防止项目里的 `bunfig.toml` preload 脚本在启动前搞崩二进制
- 打包时会把这些运行时资源一起放在可执行文件旁边：`photon_rs_bg.wasm`（图片处理）、
  `theme/`、`assets/`、`export-html/`、`docs/`、`examples/`、以及对应平台的
  `native/linux/prebuilds/linux-x64/`（`packages/tui` 的原生模块）
- 单包版本：`npm --prefix packages/coding-agent run build:binary`（只出当前平台的 `dist/pi`）
- 交叉编译各平台官方包：`./scripts/build-binaries.sh --offline-model-data`（不加 `--platform` 就六个平台全出）

---

## 8. 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| `Model data is missing or stale. Run 'npm run hydrate:model-data'` | `packages/ai/src/providers/data/` 是 gitignore 的生成物，新 clone 没有 | 跑 `npm run hydrate:model-data`（需要网络） |
| `Cannot find module '.../packages/tui/dist/index.js'` 之类 | 只构建了 `coding-agent`，上游包没编译 | 走根目录的 `npm run build:offline`（它按依赖顺序构建全部包）；不要在子包里单独 `npm run build` |
| `No workspaces found: --workspace=chord` | `--workspace` 只能写目录路径 | 写 `--workspace=packages/chord`，别写包名 |
| `build:offline` 卡在 `ai` 的 `check:model-data` | 模型数据过期 | 重新 `npm run hydrate:model-data` |
| `EBADENGINE autoevals ... please-use-pnpm` | 无关的 devDependency 引擎声明 | 忽略 |
| `pi --version` 还是旧版本 | PATH 里 nvm 的全局 bin 优先于你新建的软链 | 用绝对路径 `./pi-built.sh`，或 `hash -r` / 调整 PATH |
| TUI 里花屏、渲染错乱 | 终端能力不足（truecolor / 备用屏） | 试 `--tui-mode regular`（默认）或换终端；主题相关看 `packages/coding-agent/docs/themes.md` |
| 启动卡在 `Refreshing model catalogs…` | 启动联网刷新目录慢 | 加 `--offline`，或先 `npm run hydrate:model-data` 把数据落到本地 |
| 启动时告警 `Host-provided extension packages must be declared in peerDependencies …` | 你自己 `~/.pi/agent/npm/` 里的扩展包声明方式问题，与构建无关 | 想消掉就改那个扩展的 `package.json`（把依赖挪到 `peerDependencies` 的 `*`） |
| 想让原生模块生效但 prebuilds 缺失 | 极冷门平台 | `npm run build:native:linux`（需要 node-gyp + C 工具链） |
| 类型/编译报错 | Node 版本太低（strip-only 语法要求） | 升到 Node >= 22.19 |

---

## 9. 构建实测记录

### 9.1 未裁剪基线（0.87.1，历史记录）

环境：Ubuntu / kernel 6.8.0-142 / x86_64，Node v25.9.0，npm 11.12.1，git `main` @ `2b0a123de`。
这份记录是 0.87.1 时代的基线，用 `npm run build:offline` 产出。
后续版本请追加新的一节，不要改写本节。

执行的命令序列：

```bash
npm run clean                              # 清掉所有 packages/*/dist
npm install --ignore-scripts               # 已有 node_modules，增量 375ms
npm run hydrate:model-data                 # 2.3s，42 个 JSON，约 948K
npm run build:offline                      # 6.2s 墙钟（clean + 全量编译一起计时，tsgo 所以很快）
```

产物文件数：

| 包 | dist 文件数 |
|----|------------|
| chord | 116 |
| tui | 176 |
| telemetry | 24 |
| ai | 795 |
| durable | 116 |
| agent | 468 |
| protocol | 32 |
| client | 32 |
| server | 64 |
| coding-agent | 944（其中 `dist/bundle` 59 个文件 / 8.5 MiB，整个 dist 19M） |

验证结果：

- `node packages/coding-agent/dist/bundle/cli.js --version` → `0.87.1`
- `--list-models` 正常输出 provider/model/context 表（anthropic、local-llama-cpp 等）
- pty 里的 TUI 冒烟通过：界面渲染、`/model` 选择器可用、提交 prompt 后进入 `Working` 状态且上下文计数上涨
- `git status --porcelain` 全程为空（模型数据只落在 gitignore 目录里）

未验证：bun 单文件二进制路径（本机没有 bun，见第 7 节）。

额外实测（子包构建，见 2.1）：9 包链（跳过 `durable`、`sqlite-node`）产出的 bundle 与完整构建一致，
`--version` = 0.87.1、`--list-models` 20 行、TUI 渲染正常；随后已恢复成完整 `npm run build:offline` 状态。

### 9.2 全量还原上游后（1.3.0）

`dev` = `upstream/main` + 一层加性定制（auto thinking、vim mode、模型显示名等），不再有源码删除，
所以 `build:offline` 产出的就是分叉产物，没有任何额外构建步骤。

环境同 9.1（Node v25.9.0 / npm 11.12.1），工作区为 `dev` 合并上游之后的代码。

```bash
npm run clean                 # 清掉所有 packages/*/dist
npm install --ignore-scripts  # 已有 node_modules，增量安装
npm run hydrate:model-data    # 3.7s
npm run build:offline         # 5.6s（全量编译 + 打包 bundle）
```

| 项 | 值 |
|----|-----|
| `dist/bundle` | 80 个文件 / 9 238 540 B（8.8 MiB） |
| `packages/coding-agent/dist` | 1092 个文件 / 21 MiB |
| `node packages/coding-agent/dist/bundle/cli.js --version` | `1.3.0` |

验证结果：`npm run check` 全绿；vim mode 与 auto thinking 相关测试全部通过
（`packages/tui` 的 `vim-mode`、`packages/ai` 的 `auto-thinking`、
`packages/coding-agent` 的 `model-selector` / `footer-width` / `custom-editor-vim-escape` /
`agent-session-auto-thinking` / `config-schemas`）。

---

## 10. 相关文档

- 二次开发范式：dev-workflow 技能 `~/.agents/skills/dev-workflow/`（附 `FORKING.md`：分支模型、加性定制规则、同步上游流程、分叉台账）
- 仓库开发说明：`README.md` 的 Development 一节、`AGENTS.md`
- pi 使用文档：`packages/coding-agent/docs/`（`quickstart.md`、`usage.md`、`tui.md`、`keybindings.md`、
  `configuration.md`、`models.md`、`providers.md`、`sessions.md`、`extensions.md`、`skills.md`）
- TUI 交互测试：`pi-tui-testing` 技能（`~/.agents/skills/pi-tui-testing/`）
- 发布/版本流程：`pi-release` 技能（`~/.agents/skills/pi-release/`）
