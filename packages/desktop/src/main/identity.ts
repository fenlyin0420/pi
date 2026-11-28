// Windows 通知身份：toast 标题栏里那颗小应用图标（macOS / Linux 没有这一层）。
//
// 它来自 AUMID 对应的注册项，不是 `Notification` 的 `icon` 参数——那个参数画的是正文左侧
// 一大块方图（ChatGPT 桌面端没有那块，我们也不要）。注册项里的 `IconUri` 是一份绝对路径，
// 安装或首次弹窗时由系统写下，之后就没人再管：仓库一挪位置（`D:\GitHub\pi` → `D:\Projects\pi`）
// 它就成了悬空路径，标题栏留一个空格子。
//
// 所以每次启动都把它指回一份稳定的副本（userData 下的 PNG）：既自愈悬空路径，
// 也让开发模式与安装版共用同一份图标。写注册表失败不算错，通知本身照发。

import { spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export type IdentityOptions = {
	/** 与 electron-builder.yml 的 appId、`app.setAppUserModelId` 保持一致。 */
	aumid: string;
	/** 通知中心里显示的应用名。 */
	displayName: string;
	/** 源图标（`resources/icon.png`）：启动时拷一份到 userData，注册项只指向那份副本。 */
	iconSource: string;
};

export function installWindowsNotificationIdentity(options: IdentityOptions): void {
	if (process.platform !== "win32") return;
	let icon = options.iconSource;
	try {
		const stable = join(app.getPath("userData"), "notification-icon.png");
		copyFileSync(options.iconSource, stable);
		icon = stable;
	} catch (error) {
		// 拷不动就退回仓库里那份：图标可能哪天又悬空，但通知本身不受影响。
		console.error("[desktop] notification icon copy failed", error);
	}
	const key = `HKCU\\Software\\Classes\\AppUserModelId\\${options.aumid}`;
	for (const [name, value] of [
		["DisplayName", options.displayName],
		["IconUri", icon],
	] as const) {
		try {
			spawnSync("reg", ["add", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"], { windowsHide: true });
		} catch (error) {
			console.error(`[desktop] notification identity write failed (${name})`, error);
		}
	}
}
