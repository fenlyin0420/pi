// 通知窗口的 preload：把 NoticeBridge 暴露成 window.piNotice。只做透传，不做任何转换。
//
// 有一个例外：卡片会先到。main 在页面的 did-finish-load 时就把第一张推下来，而 React 那边的
// 订阅是挂载之后才生效的，直接丢会漏掉第一张。preload 比页面先跑，所以在这里排队，
// 等订阅上来再补发。

import { contextBridge, ipcRenderer } from "electron";
import type { NoticeBridge, NoticeView } from "../shared/contract.ts";
import { IPC_NOTICE_ACTIVATE, IPC_NOTICE_MEASURE, IPC_NOTICE_PUSH } from "../shared/notice-ipc.ts";

/** 订阅还没来之前的卡片；来了就按顺序补发。 */
const pending: NoticeView[] = [];
let listener: ((notice: NoticeView) => void) | null = null;

ipcRenderer.on(IPC_NOTICE_PUSH, (_event, notice: NoticeView) => {
	if (listener) listener(notice);
	else pending.push(notice);
});

const bridge: NoticeBridge = {
	onNotice: (next) => {
		listener = next;
		for (const notice of pending.splice(0)) next(notice);
		return () => {
			if (listener === next) listener = null;
		};
	},
	activate: (id) => ipcRenderer.send(IPC_NOTICE_ACTIVATE, id),
	measure: (height) => ipcRenderer.send(IPC_NOTICE_MEASURE, height),
};

contextBridge.exposeInMainWorld("piNotice", bridge);
