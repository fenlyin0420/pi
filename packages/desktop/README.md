# @earendil-works/pi-desktop

Electron 桌面端：main 进程持有 pi 会话，renderer 只通过 IPC 契约渲染与下发命令。

## 进程布局

- `src/main/`：Electron 主进程。
  - `index.ts`：装配设置、主题、会话中枢、窗口与菜单，注册 IPC。
  - `session-host.ts`：会话中枢。打开过的会话各保留一个活 `AgentSession`，切走不打断运行；
    事件在这里合并（一帧一次的整体快照，含尚未提交的流式消息）后推给 renderer。
  - `session-files.ts` / `file-search.ts`：会话文件的列出、改名、删除，以及 `@` 引用用的项目文件搜索。
  - `transcript.ts`：消息到 transcript 契约的纯映射（思考块、工具卡片、diff、用量、错误）。
  - `settings.ts`：`userData/settings.json` 的读写（逐字段校验、去抖、原子替换），窗口几何也在里面。
  - `window.ts` / `menu.ts`：无边框窗口、几何恢复、外部链接收口；应用菜单只发动作 id。
- `src/preload/`：`contextBridge` 暴露 `window.piDesktop`，只做透传。
- `src/renderer/`：React UI。`App.tsx` 负责主题注入、快捷键与菜单动作分发；
  `store.ts` 折叠事件；`components/` 按区域拆成 sidebar / transcript / composer / settings；
  `styles/` 是从参考实现移植的设计系统（token、重新着色、组件样式）。
- `src/shared/contract.ts`：main 与 renderer 之间全部数据形状、命令与事件。

## 功能

- **窗口**：窗口按钮交给系统——Windows 用无框 + Window Controls Overlay，Linux 用原生框，
  macOS 保留原生红绿灯；窗口位置/尺寸/最大化恢复，系统深色/浅色跟随，字号缩放与密度可调。
- **侧栏**：项目切换与最近项目、会话搜索、按今天/昨天/过去 7 天/更早分组、置顶、右键改名/删除、
  拖拽调宽、折叠。
- **对话区**：用户气泡、助手 Markdown（GFM、表格、shiki 代码高亮与复制）、每个 step 的思考与
  工具调用折成一行活动链（默认收起，标题只报数量——几个工具、几段思考，结束后再加耗时；
  整轮跑着时标题下面多一行，预览当前这一步——思考带正文最新一段、工具带调用摘要，文字走扫光，
  中途的正文出来也不退回摘要），模型输出的正文按原顺序紧跟在那段过程后面、
  工具行展开参数/结果、edit/write 的行内 diff、每轮用量胶囊、
  运行中贴在对话尾部的一行状态（“Working for 12s”这类与步骤无关的通用文案，每八秒换一句，
  秒表是这一轮的总时长）、
  右侧用户消息定位条（悬浮预览、单击或拖动跳转）、贴底跟随与回到底部按钮。
- **输入区**：自增高输入框、中文输入法安全的 Enter、草稿按会话保存、`/` 命令面板、
  `@` 文件引用补全、附件（回形针选文件、任意文件拖拽、图片粘贴）、模型选择（搜索 + 可用性）、
  思考等级、上下文占用与费用。附件图片作为图片内容直传，其余文件只把路径告诉模型，
  由 agent 自己的文件工具去读；附件上限 8 个，单张图片 10 MB。
  运行中 Enter 变成排队（steer），Stop 中止当前运行。
- **命令面板**（⌘K / Ctrl+K）：动作 + 会话搜索，键盘可操作。
- **ask_user**：`@eko24ive/pi-ask` 的提问在桌面端画成作答面板（单选/多选、自填、整次备注）；
  会话以 `mode: rpc` 绑定扩展、宿主自带事件总线，走 pi-ask 的 started/submit 契约。
- **设置页**：外观（主题/字号/密度/显示项）、当前 agent 状态、会话信息，改动即时生效。

## 运行

```sh
npm install --ignore-scripts
node node_modules/electron/install.js
npm run desktop:dev                     # 仓库根，开发模式
npm run desktop:build                   # 产物在 packages/desktop/out/
npm run check:desktop                   # 只跑本包的 tsc
npm --prefix packages/desktop run test  # 纯映射与状态折叠的单元测试
```

pi SDK 是运行时依赖，main 侧保持 `external`；类型检查通过根 `tsconfig.json` 的 paths 读 pi 源码。

Linux 上 Electron 的 SUID sandbox 需要 root 属主的 `chrome-sandbox`（4755），否则用
`ELECTRON_DISABLE_SANDBOX=1 npm run desktop:dev`。

## 已知边界

- 只做单窗口单项目，没有插件、MCP 管理、语音、computer-use、远程主机、定时任务与工作树面板。
- 没有打包产物与自动更新。
- 助手消息里的原始 HTML 一律丢弃（`skipHtml`）。
- 大目录的 `@` 搜索在 main 同步遍历（上限 2 万文件，5 秒缓存）。

## 许可证

本目录以 LGPL-3.0 发布（见 `LICENSE-LGPL-3.0`）；移植来源与边界见 `NOTICE.md`。pi 本体仍是 MIT。
