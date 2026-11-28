// 通知窗口那三个 IPC 通道名，单独一个文件。
//
// 为什么不在 contract.ts 里：preload 有两个入口（主窗口一份、通知窗口一份），而沙箱里的
// preload 只能是单文件——rollup 会把两个入口共用的模块提到 `preload/chunks/` 里，沙箱加载不到
// （"module not found"）。让通知那边的 preload 只依赖这一个文件、主窗口那边不依赖它，
// 两份产物就各自自洽，不会生出公共 chunk。形状（NoticeView / NoticeBridge）仍留在 contract.ts。

export const IPC_NOTICE_PUSH = "pi-desktop:notice-push";
export const IPC_NOTICE_ACTIVATE = "pi-desktop:notice-activate";
export const IPC_NOTICE_MEASURE = "pi-desktop:notice-measure";
