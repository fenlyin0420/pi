// renderer 侧给 preload 注入的桥接类型；主题之外没有别的全局变量。

import type { DesktopBridge } from "../shared/contract.ts";

declare global {
	interface Window {
		piDesktop: DesktopBridge;
	}
}
