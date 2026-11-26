// 应用菜单：系统标准编辑/窗口角色 + 桌面动作；动作只发 id，由 renderer 转成命令。

import { app, Menu, type MenuItemConstructorOptions } from "electron";
import type { MenuAction } from "../shared/contract.ts";

/** 安装应用菜单。macOS 保留应用菜单块，其他平台用 File 菜单承载同样的动作。 */
export function installMenu(send: (action: MenuAction) => void): void {
	const mac = process.platform === "darwin";
	const action = (label: string, id: MenuAction, accelerator?: string): MenuItemConstructorOptions => ({
		label,
		accelerator,
		click: () => send(id),
	});

	const template: MenuItemConstructorOptions[] = [
		...(mac
			? [
					{
						label: app.name,
						submenu: [
							{ role: "about" as const },
							{ type: "separator" as const },
							action("Settings…", "settings", "Cmd+,"),
							{ type: "separator" as const },
							{ role: "services" as const },
							{ type: "separator" as const },
							{ role: "hide" as const },
							{ role: "hideOthers" as const },
							{ role: "unhide" as const },
							{ type: "separator" as const },
							{ role: "quit" as const },
						],
					},
				]
			: []),
		{
			label: "File",
			submenu: [
				action("New Session", "newSession", "CmdOrCtrl+N"),
				action("Add Workspace…", "addWorkspace", "CmdOrCtrl+O"),
				{ type: "separator" },
				action("Close Session", "closeSession", "CmdOrCtrl+W"),
				...(mac
					? []
					: ([{ type: "separator" }, action("Settings…", "settings", "Ctrl+,")] as MenuItemConstructorOptions[])),
				...([] as MenuItemConstructorOptions[]),
				{ type: "separator" },
				mac ? { role: "close" } : { role: "quit" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				action("Search…", "search", "CmdOrCtrl+K"),
				action("Toggle Sidebar", "toggleSidebar", "CmdOrCtrl+B"),
				{ type: "separator" },
				{ role: "reload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: "Window",
			role: "windowMenu",
		},
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
