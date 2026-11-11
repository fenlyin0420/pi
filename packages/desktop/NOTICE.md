# NOTICE

`packages/desktop` 是 pi 的桌面端：一个 Electron 宿主进程加一套 React UI。

- pi 本体：https://github.com/earendil-works/pi ，MIT。
- UI 与进程布局的参考实现：https://github.com/vastsa/pi-desktop ，LGPL-3.0。

## 移植范围

以下文件来自参考实现（LGPL-3.0），做了两处机械改动：`@theme` 块改成 `:root`（本项目不引入
Tailwind），并去掉了 Tailwind 的入口导入。其余内容与参考实现一致。

- `src/renderer/styles/tokens.css`
- `src/renderer/styles/base.css`
- `src/renderer/styles/ui-kit.css`
- `src/renderer/styles/chrome.css`
- `src/renderer/styles/chat-shell.css`
- `src/renderer/styles/messages.css`
- `src/renderer/styles/prose.css`
- `src/renderer/styles/composer.css`
- `src/renderer/styles/composer-menus.css`
- `src/renderer/styles/sidebar-threads.css`
- `src/renderer/styles/overlays.css`
- `src/renderer/styles/theme-overrides.css`
- `src/renderer/styles/responsive.css`
- `src/renderer/styles/markdown-table.css`

renderer 组件的 DOM 结构与 class 命名沿用参考实现，使上面的样式表直接生效；组件逻辑按本项目的
契约与状态模型重写（参考实现依赖 zustand、i18n、插件运行时与 sidecar IPC，这些都没有带过来）。

## 许可证

`packages/desktop` 下由参考实现派生或移植的代码同样以 LGPL-3.0 发布，全文见本目录的
`LICENSE-LGPL-3.0`。仓库其余部分保持各自原有许可证。
