# 任务：desktop 沉浸模式（模型的最终回答是一份可交互 HTML）

本文件是实现简报：只读这一份就能开工。所有路径相对 `packages/desktop/`，除非另写。

## 目标

每个会话一个「沉浸模式」开关。打开后：

- 主栏由「HTML 舞台」替代对话区，模型每一轮的最终产物是一份自包含 HTML 文档，舞台把它放进沙箱 iframe 渲染；
- 主栏**没有底部输入框**：`Composer` 整块（工具栏、附件、模型选择、todo 条、队列条、提问卡）在沉浸模式下都不渲染，
  输入只来自页面自己画的输入框；
- 进入沉浸模式先看到一张**宿主生成的入口页**：页面里画着输入框，用户在这里写下的第一句话就是初始化，
  发出去之后才轮到模型产出第一版页面；
- 之后每一轮是同一个循环：模型页面在**开头回显这一轮的用户消息**、在**末尾给出下一轮的输入框**，
  用户在页面里提交的话通过 `postMessage` 变成一条用户消息，进入下一轮，模型据此产出下一版 HTML；
- 关掉开关，一切回到现在的对话区（`Composer` 回来），历史里的 HTML 显示成一张卡片，点开可全屏预览。

## 非目标（本任务不做）

- 不做 artifact 库/收藏/发布/分享链接/导出 `.html`。
- 不做离线 runtime（Tailwind、React、图表库），不放开 CDN 与外网请求。
- 不自动补一轮「你没按契约输出 HTML」；只给一个手动重试入口。
- 不校验页面有没有回显用户消息、有没有画出输入框（无法可靠校验）；模型不守约时用户仍可退出沉浸，回到对话区说话。
- 不做页面内的 `ask_user` 作答界面：沉浸模式下提问卡片随 `Composer` 一起下线。
- 不换 `WebContentsView`（进程隔离），见「延后」。
- 不动 `Markdown.tsx` 的 `skipHtml`：对话区的 markdown 永不执行模型写的 HTML。

## 前置事实（已核实，别再重新调研）

1. 会话由 `src/main/session-host.ts` 的 `createSession()` 逐个用 `createAgentSessionServices({ cwd, resourceLoaderOptions: { eventBus }, modelRuntime })` 创建。`DefaultResourceLoaderOptions.extensionFactories: InlineExtension[]`，`InlineExtension = ExtensionFactory | { name, factory, hidden?, replaceable? }`，`ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>`。**因此可以在 desktop 侧用内联扩展给单个会话加系统提示和工具，不需要改 coding-agent。**
2. 扩展里 `pi.registerTool({ name, label, description, promptSnippet?, parameters, execute })`；`before_agent_start` 处理器返回 `{ systemPrompt }` 可整体替换这一轮的系统提示。参考现有写法：`src/main/issues/tools.ts`（TypeBox `Type.Object` 参数、`{ content: [{ type: "text", text }], details }` 返回值）。
3. transcript 投影在 `src/main/transcript.ts`：`ToolCallView` 已经带上 `toolResult.details`（未截断）；`AssistantPart` 是 `text | thinking | tool`；`toParts()` 按消息里的 content block 生成。
4. 主窗口 CSP 在 `index.html`：`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'`。**`frame-src` 落到 `default-src 'self'`，所以现在加载不了自定义 scheme 的 iframe，必须加一条。**
5. `srcdoc` iframe 继承父文档 CSP（HTML 规范），`script-src 'self'` 会静默打死模型的内联脚本 → 不能用 `srcdoc`，也不能用 `blob:`（blob 文档同样继承创建者的 CSP）。**必须用自定义协议 + 响应头带独立 CSP。**
6. `src/main/index.ts` 在模块顶层建 `SessionHost`，`app.whenReady()` 里注册 IPC 与窗口。`registerSchemesAsPrivileged` 必须在 ready 之前调用，`protocol.handle` 在 ready 之后、建窗口之前。
7. 设置持久化在 `src/main/settings.ts`：`DEFAULT_SETTINGS`、`normalizeSettings()`（逐字段校验，`stringList(input.pinnedSessions, PINNED_LIMIT)` 这种写法）。
8. renderer 装配在 `src/renderer/App.tsx` 的 `main-column`：现在是 `Transcript` + `Composer`，`DiffPanel` 在右栏，`IssuesPage` 是另一块 surface。样式在 `src/renderer/styles/*.css`，用 token，不写死颜色。

## 已定的设计决定（照做，不要再讨论）

1. **产物来源：工具优先，围栏块兜底。** 内联扩展给会话注册 `render_html` 工具，系统提示要求每轮最后一步调用一次。工具校验失败就 `isError` 让模型自己修。没有工具调用但正文里有唯一一个 ```html 围栏块的轮，退化成 artifact（标 `source: "fence"`）。两条都没有就正常显示 markdown。
2. **HTML 存在 `toolResult.details` 里**，不另建文件：会话重开能原样重放，删会话自动清。
3. **每个会话都注册 `render_html`（不只是沉浸会话）**，因为工具集在建会话时就定了，中途切换模式不该重建会话；提示词注入才是按模式条件生效的。非沉浸会话里它只是个可用的普通工具，产物显示成卡片。
4. **交互 = 一条用户消息。** HTML 调 `window.pi.submit(text)` → renderer 校验 `event.source === iframe.contentWindow` → `send({ type: "prompt", text })`；agent 正在跑时走现有的排队/steer 语义。不新增 RPC、不让 HTML 直接调工具。
5. **沙箱边界**：iframe `sandbox="allow-scripts allow-forms"`（不给 `allow-same-origin`、`allow-popups`、`allow-modals`、`allow-top-navigation`、`allow-downloads`）；文档 CSP 断网、禁外链。不做 DOMPurify：沙箱 + 独立 CSP 就是边界，清洗只会把正常的交互页面洗坏。
6. **流式期间不渲染半截 HTML**：只在消息 `streaming === false` 之后换文档，换时 iframe 换 `key` 整帧重挂载。运行中保留上一份 HTML，上面盖一条「Working…」细提示条。
7. **模式粒度是会话**：`DesktopSettings.immersiveSessions: string[]`（上限 500，跟 `pinnedSessions` 同一套校验）。
8. **输入只在 HTML 里**：沉浸模式不渲染 `Composer` 及其所有 dock，主栏只有舞台；舞台顶栏只留宿主自己的操作
   （轮次、源码、全屏、退出），退出沉浸的按钮就在那里。
9. **入口页与页面外的两块都由宿主画，不由模型产出**：会话还没有任何落地产物时，舞台中间是宿主自己的
   入口面板（说明 + 几个可点的例子），输入走底部那条 composer。
10. **回显与下一轮输入口是宿主的**：舞台在帧上方固定显示这一轮的用户消息（含附件缩略图，点开看原图），
    下方固定一条输入框（Enter 发出、运行中变成排队、Shift+Enter 换行）。这两块与页面 HTML 无关，
    模型不写也在；`IMMERSIVE_PROMPT` 因此要求页面只画内容，不要回显消息、不要自己画输入框。
11. **观感统一**：宿主给每份文档（页面与任何宿主拼的页面）注入一套 `--pi-*` 变量（底色、表面、文字、
    强调色、圆角、字体、阴影）加一层基础排版，深色/浅色各一套；模型照变量画就和界面同一套灰阶。

## 数据契约（`src/shared/contract.ts`）

```ts
/** 一份渲染出来的 HTML 产物：工具产出，或从正文围栏块兜底提取。 */
export type ArtifactView = {
	id: string;
	title: string;
	html: string;
	source: "tool" | "fence";
};

export type AssistantPart =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "tool"; call: ToolCallView }
	| { type: "artifact"; artifact: ArtifactView };
```

- `DesktopSettings` 加 `immersiveSessions: string[]`。
- `DesktopCommand` 加 `{ type: "setImmersive"; sessionId: string | null; immersive: boolean }`（`sessionId` 为 `null` 时作用在当前会话上）。它既写设置，也要通知宿主更新该会话的内存标志（下一轮 `before_agent_start` 生效）。
- 不需要新 IPC 通道：iframe 的内容通过自定义协议取，交互复用 `prompt`/`openExternal` 命令。

## 切片

按顺序做，每片结束都要 `npm --prefix packages/desktop run test` 与 `npm run check:desktop` 通过。

### 切片 1：协议、文档拼装、只读预览

新增 `src/main/artifacts.ts`：

- `ARTIFACT_SCHEME = "pi-artifact"`，`ARTIFACT_CSP`（见下），`MAX_ARTIFACT_BYTES = 512 * 1024`。
- `composeDocument(html: string, theme: "dark" | "light"): string` —— 纯函数。把宿主 bridge 脚本注入到 `<head>` 之后（没有 `<head>` 就注入到 `<html>` 之后，都没有就前置），并在最前面放 `:root { color-scheme: light dark }` 与 `data-theme` 的默认观感；重复调用不重复注入。bridge 暴露：
  - `window.pi.submit(text)` → `parent.postMessage({ source: "pi-artifact", type: "submit", text }, "*")`
  - `window.pi.openExternal(url)` → 同上，`type: "openExternal"`
  - `window.pi.ready()` → `type: "ready"`
  bridge 脚本必须是普通字符串拼装（不依赖模板里的反引号），并且只注入一次。
- `artifactKey(sessionId: string, itemId: string): string`、`parseArtifactRequest(url: URL): { key: string } | null` —— 纯函数，供协议 handler 用。URL 形状：`pi-artifact://session/<sessionId>/<itemId>`。
- `registerArtifactScheme()`：`protocol.registerSchemesAsPrivileged([{ scheme: ARTIFACT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }])`，只能在 ready 前调用。
- `installArtifactProtocol(deps: { theme(): "dark" | "light" })`：ready 后调用 `protocol.handle(ARTIFACT_SCHEME, ...)`，从缓存取 html，返回 `new Response(composeDocument(...), { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": ARTIFACT_CSP } })`；找不到 key 返回 404 文本；正文超过 `MAX_ARTIFACT_BYTES` 返回一个说明页（不抛异常）。
- 缓存：`Map<string, string>`（key → html），由 `src/main/session-host.ts` 在投影 transcript 时写入，会话被删除时按 `sessionId` 前缀清空。缓存只是给协议 handler 用的投递层，不是第二份真相。

`ARTIFACT_CSP`：

```text
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'
```

`index.html` 的 CSP 加 `frame-src pi-artifact:`（只放这一个 scheme）。

`src/main/index.ts` 接线：导入处调用 `registerArtifactScheme()`（模块顶层，ready 之前），`app.whenReady()` 里在建窗口之前调用 `installArtifactProtocol({ theme: resolvedTheme })`。

renderer 新增：

- `src/renderer/lib/artifact.ts`：`artifactUrl(artifact, theme)`、`readArtifactMessage(data: unknown): ArtifactMessage | null`（校验 `source === "pi-artifact"`、`type` 白名单、`text`/`url` 是字符串且长度受限）、`artifactsOf(items)`、`latestArtifact(items)`、`artifactSource(artifact)`（源码视图用的 html 文本）。
- `src/renderer/components/artifact/ArtifactFrame.tsx`：`iframe sandbox="allow-scripts allow-forms"`，`src` 来自 `artifactUrl`，`onLoad` 后开始接收消息；消息分派由 `onSubmit(text)` / `onOpenExternal(url)` 两个回调承担，`source` 校验在组件里用 `event.source === frame.contentWindow`。`key` 由 artifact id 决定。
- `src/renderer/components/artifact/ArtifactCard.tsx`：非沉浸态的卡片（标题、限高预览、全屏按钮），挂在 `AssistantTurn` 的正文序列里，位置取 artifact part 出现的位置。
- `src/renderer/styles/artifact.css`：舞台/卡片样式，只用现有 token。

切片 1 完成后：沉浸模式还没有开关，但 transcript 里有 artifact 就能显示卡片与全屏。

### 切片 2：工具、提示词、开关、沉浸布局

新增 `src/main/immersive.ts`：

- `IMMERSIVE_PROMPT`（中文/英文皆可，必须包含这些约束）：
  - 每一轮的最后一步必须调用一次 `render_html`，不要在正文里贴 HTML；
  - `html` 必须是一份完整自包含文档（`<!doctype html>` 起），**不得引用任何外部资源**：无 CDN、无字体、无图片 URL、无 `fetch`（网络被禁，引用即空白），需要图片就用内联 SVG 或 data URL；
  - 交互通过 `window.pi.submit("一句话用户意图")` 回传；不需要交互就做纯静态页面；
  - 排版自己写内联 `<style>`，深色/浅色跟随 `document.documentElement.dataset.theme`（宿主已注入 `dark` / `light`）；
  - 一页一个主题，标题写进 `title` 参数。
- `readArtifactCall(name, details): ArtifactInput | null` —— 纯函数，校验 `{ title, html }`（非空、`html.length <= MAX_ARTIFACT_BYTES`、以 `<` 开头）。
- `fenceArtifact(text: string): ArtifactInput | null` —— 纯函数，从一段正文里取出**唯一**的 ```html 围栏块（多于一个或没有就返回 null），用于兜底。
- `createImmersiveExtension(isImmersive: () => boolean): InlineExtension` —— 返回 `{ name: "desktop-immersive", hidden: true, factory }`：
  - `factory` 里 `pi.registerTool(renderHtmlTool)`；
  - `pi.on("before_agent_start", (event) => isImmersive() ? { systemPrompt: `${event.systemPrompt}\n\n${IMMERSIVE_PROMPT}` } : undefined)`（按实际的 `ExtensionAPI.on` 签名写）。
  - `render_html` 工具：`parameters: Type.Object({ title: Type.String({ maxLength: 200 }), html: Type.String({ maxLength: MAX_ARTIFACT_BYTES }) })`；`execute` 返回 `{ content: [{ type: "text", text: "Rendered." }], details: { title, html } }`；校验失败 `throw new Error("...")`（工具报错会回给模型，让它自己修）。

`src/main/session-host.ts` 接线：

- `createSession()` 的 `resourceLoaderOptions` 加 `extensionFactories: [createImmersiveExtension(() => this.immersive.has(sessionId))]`。注意 `sessionId` 在建会话前拿不到：用 `manager.getSessionId()` 或建会话后按 `session.sessionId` 注册到一个 `Set`，工厂闭包里读这个 Set（`isImmersive()` 只在这一轮开始时被调用，时序安全）。
- `this.immersive: Set<string>` 从 `settings.get().immersiveSessions` 初始化；`setImmersive` 命令改 Set 并 `settings.update({ immersiveSessions })`。
- 投影 transcript 时把每个 artifact 的 html 写进 `artifacts.ts` 的缓存（含 `source: "fence"` 的兜底产物，这样兜底也能渲染）。

`src/main/transcript.ts`：

- `toParts()`：遇到 `toolCall.name === "render_html"` 且 `readArtifactCall(name, result.details)` 成功 → 推 `{ type: "artifact", artifact: { id: \`artifact-${index}\`, title, html, source: "tool" } }`，**不再**推 `tool` part（沉浸模式下不显示这一行工具卡片）；细节不合法才落回普通 `tool` part。
- 兜底：对轮末消息（`message.stopReason !== "toolUse"`，即不再要工具）且这一条里没有任何 artifact part 时，取最后一个 text block 调 `fenceArtifact()`，成功就推 `{ type: "artifact", ..., source: "fence" }`。

renderer：

- `App.tsx`：`main-column` 里按 `settings.immersiveSessions.includes(activeSessionId)` 切换 `ArtifactStage` 与 `Transcript`；
  沉浸态**不渲染 `Composer`**（连同 `AskDock` / `TodoDock` / 队列条），非沉浸态和现在完全一样。
- `src/renderer/components/artifact/ArtifactStage.tsx`：顶部细条（会话标题 / 轮次下拉：这一轮、上一轮… / 预览↔源码 / 全屏 / 退出沉浸）
  + 中间 `ArtifactFrame`（`flex: 1`，自身滚动交给文档）
  + **没有任何落地产物时显示入口页**（`ArtifactFrame` 指向 entry 地址，用户就在这里说第一句话，
  不再是一段“写一句话…”的文字空态）
  + 有产物但本轮没有 HTML 时顶部一条「No HTML this turn · Retry」（发一条固定文案的 prompt）。
- `Composer` 工具栏加一颗切换按钮（只有非沉浸态才看得到它，进去之后靠舞台顶栏退出）；
  `CommandPalette` 加一项；快捷键按 `src/renderer/App.tsx` 现有 `useEffect` 键盘处理的写法加，
  **不要**硬编码到别处（跟随项目的 keybinding 约定）。
- `src/main/settings.ts`：`immersiveSessions` 加进 `DEFAULT_SETTINGS`（`[]`）与 `normalizeSettings`（`stringList(..., PINNED_LIMIT)`）。

### 切片 3：交互回传

- `ArtifactFrame` 的 `onSubmit(text)` → `send({ type: "prompt", text })`；`onOpenExternal(url)` → 现有的 `openExternal` 命令，只放 http/https。
  入口页和模型页面走同一条路：入口页写第一句、页面里点按钮写下一句，都是 `window.pi.submit`。
- 提交后舞台不立刻清空：保留当前 HTML（入口页也保留），按现有 `agent.status` 显示「Working…」条；
  下一份 artifact 到了再换帧。模型页面自己不需要保留输入框里的字——换帧就是新页面。
- 校验：`readArtifactMessage` 里限制 `submit` 文本长度（比如 8k）、`openExternal` 只接受 http(s)；不合法直接丢。

## 测试（`packages/desktop/test/`，纯函数为主，vitest）

- `artifacts.test.ts`：`composeDocument` 三处注入位置（有 head / 只有 html / 裸片段 + doctype 之后）、只注入一次、theme 属性、bridge 里三个 API 的 postMessage 形状、主题表的两套取值与“排在页面自己的样式之前”；`MAX_ARTIFACT_BYTES` 边界；`parseArtifactRequest` 的合法/畸形 URL；`ARTIFACT_CSP` 包含 `script-src 'unsafe-inline'` 且不含 `allow-same-origin` 相关放行。
- `immersive.test.ts`：`readArtifactCall` 的校验分支；`fenceArtifact` 只有一块/多块/无块/未闭合/大小超限；`IMMERSIVE_PROMPT` 里同时有“回显这一轮用户消息”和“末尾给出下一轮输入框 / `window.pi.submit`”。
- `transcript.test.ts`（扩展现有文件）：`render_html` 合法 details → artifact part 且没有同名 tool part；details 不合法 → 落回 tool part；轮末围栏块 → `source: "fence"`；有工具产物时不再走兜底。
- `settings.test.ts`（扩展现有文件）：`immersiveSessions` 去重、非字符串过滤、上限。
- `artifact-messages.test.ts`：renderer 侧 `readArtifactMessage` 的校验与拒绝分支。
- iframe 与 IPC 的端到端行为不做自动测试，走手工验收。

## 手工验收

```sh
cd <worktree> && npm install --ignore-scripts && npx husky
node node_modules/electron/install.js     # 每个 worktree 都要装一次 electron 二进制
npm run desktop:dev
```

1. 新会话 → 工具栏打开沉浸模式（设置里能看到该会话入选）→ 主栏只有舞台：中间是入口面板，
   **对话区那个输入框没了**，底部只有舞台自己的 composer。
2. 在底部 composer 输入「做一个能加减的计数器页面」→ 回车 → 运行中保留入口面板 + 「Working…」条 →
   一轮结束后换成模型页面：**帧上方固定显示这条用户消息（带附件的会显示缩略图）**，下方仍是 composer。
3. 页面里的按钮能点；点「+」只改页面自己的状态，不发消息。在底部 composer 再写一句并回车 →
   这条成为下一条用户消息，下一版页面头上显示它。
4. 关掉沉浸模式（舞台顶栏退出）：对话区与 `Composer` 回来，历史 artifact 显示成卡片，点开能全屏。
5. 重启应用，打开同一个会话，沉浸模式仍开着，历史 artifact 仍能渲染（说明走了会话文件回放）；
   没产物的会话重新打开时回到入口页。
6. 反面用例：让模型写一个 `while(true){}` 的页面 —— 记录现象（预期：界面卡住，刷新窗口恢复），这是已知风险，不要尝试在本任务里修。
7. 反面用例：让模型只写正文不调 `render_html` —— 舞台保留上一版并在顶部给出「No HTML this turn · Retry」，不自动追问。

## 文档与台账

- `README.md` 的「功能」段加一节「沉浸模式」，写法对齐现有条目（先讲用户看到什么，再讲边界）。
- 不加 CHANGELOG（本任务目标分支是 `dev`，不是 `main`）。
- fork 台账：在 `.agents/memory/fork-ledger-packages-desktop.md` 的对应条目里补一行「沉浸模式」，列出新增文件与接线点（这是本地文件，不入库）。

## 规则与命令

- 代码改动开工前建 worktree：`git worktree add ../pi-desktop-immersive -b feat/desktop-immersive dev`，并在 worktree 里 `npm install --ignore-scripts && npx husky`，用 `git commit --allow-empty -m probe` 确认 hook 真的跑了再继续。
- 只做加性改动：新增文件 + 少量接线；不改上游包（`packages/ai`、`packages/coding-agent`、`packages/tui`）任何一行。
- 不用 `any`；无内联 import；不用 `__dirname`（desktop 用 `import.meta.dirname`）；TypeScript 只用可擦除语法。
- 每片结束：`npm --prefix packages/desktop run test`、`npm run check`（全量输出，修掉所有 error/warning/info）。
- 不要 `npm test`、不要动其他会话的暂存区、不提交除非用户要求。

## 风险与延后

1. **同进程冻结**：自定义 scheme 的 iframe 在 Chromium 里基本不做站点隔离，artifact 里的死循环会连主界面一起冻住（验收第 6 条）。延后项：换成 `WebContentsView`（独立 renderer 进程 + `partition: "persist:artifact"` + preload 提供同一份 `window.pi` bridge + 主进程同步 bounds），代价是浮层盖不住它、需要焦点处理。
2. **模型不守约**：小模型常常只写正文。兜底围栏块能救一部分；不做自动追问（会多花一次输出 token）。
   页面也可能漏掉回显或下一轮输入框：那两处只能靠提示词，用户随时可以退出沉浸回对话区。
3. **`ask_user` 在沉浸模式里没有作答界面**：提问卡片随 `Composer` 下线，模型若调用它只能等到超时。
   把提问搬进页面（`window.pi.ask`）是后续工作。
4. **成本**：HTML 输出通常比等价的 markdown 贵 2–5 倍，所以默认关闭、按会话开。
5. **会话文件体积**：每个 artifact 最多 512KB 进会话文件。真成问题再改成「只存 hash，正文落 `userData/artifacts/`」，并连带删会话时清理。
6. **主题**：只注入 `data-theme`，不保证模型页面好看；页面可以完全不理会它。不做强制注入样式，避免和模型自己的设计打架。
