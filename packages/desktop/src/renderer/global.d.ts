// renderer 侧给 preload 注入的桥接类型；主题之外没有别的全局变量。
// 通知窗口是另一个页面、另一个 preload，所以它有自己那一份（piNotice）。

import type { DesktopBridge, NoticeBridge } from "../shared/contract.ts";

declare global {
	interface Window {
		piDesktop: DesktopBridge;
		piNotice: NoticeBridge;
	}
}
