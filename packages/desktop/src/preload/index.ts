// preload：把 DesktopBridge 暴露成 window.piDesktop。只做透传，不做任何转换。

import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopBridge, DesktopEvent } from "../shared/contract.ts";
import {
	IPC_ATTACH_FILES,
	IPC_COMMAND,
	IPC_EVENT,
	IPC_GET_STATE,
	IPC_ISSUE_IMAGE,
	IPC_MESSAGE_IMAGE,
	IPC_OPEN_ATTACHMENT,
	IPC_SAVE_ISSUE_IMAGE,
} from "../shared/contract.ts";

const bridge: DesktopBridge = {
	getState: () => ipcRenderer.invoke(IPC_GET_STATE),
	send: (command) => ipcRenderer.invoke(IPC_COMMAND, command),
	attachFiles: (paths) => ipcRenderer.invoke(IPC_ATTACH_FILES, paths),
	openAttachment: (path) => ipcRenderer.invoke(IPC_OPEN_ATTACHMENT, path),
	readMessageImage: (sessionId, messageIndex, imageIndex) =>
		ipcRenderer.invoke(IPC_MESSAGE_IMAGE, sessionId, messageIndex, imageIndex),
	resolveIssueImage: (workspace, source) => ipcRenderer.invoke(IPC_ISSUE_IMAGE, workspace, source),
	savePastedImage: (data) => ipcRenderer.invoke(IPC_SAVE_ISSUE_IMAGE, data),
	// 渲染进程拿不到 File.path，只能由 preload 侧的 webUtils 换算成磁盘路径。
	pathForFile: (file) => webUtils.getPathForFile(file),
	onEvent: (listener) => {
		const handler = (_event: unknown, payload: DesktopEvent) => listener(payload);
		ipcRenderer.on(IPC_EVENT, handler);
		return () => {
			ipcRenderer.removeListener(IPC_EVENT, handler);
		};
	},
};

contextBridge.exposeInMainWorld("piDesktop", bridge);
