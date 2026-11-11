// preload：把 DesktopBridge 暴露成 window.piDesktop。只做透传，不做任何转换。

import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopEvent } from "../shared/contract.ts";
import { IPC_COMMAND, IPC_EVENT, IPC_GET_STATE } from "../shared/contract.ts";

const bridge: DesktopBridge = {
	getState: () => ipcRenderer.invoke(IPC_GET_STATE),
	send: (command) => ipcRenderer.invoke(IPC_COMMAND, command),
	onEvent: (listener) => {
		const handler = (_event: unknown, payload: DesktopEvent) => listener(payload);
		ipcRenderer.on(IPC_EVENT, handler);
		return () => {
			ipcRenderer.removeListener(IPC_EVENT, handler);
		};
	},
};

contextBridge.exposeInMainWorld("piDesktop", bridge);
