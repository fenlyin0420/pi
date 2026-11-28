// 任务栏徽标：弹过通知、你还没回来看的会话数，画在应用图标上。
//
// Windows 走 `setOverlayIcon`（自己画数字，图在 resources/taskbar/），macOS 走 `app.dock.setBadge`
// （系统自己画数字），Linux 没有对应接口，什么都不做。
// 数字只在变化时才重设：`setOverlayIcon` 每次调用都会让任务栏重绘一遍。
//
// 数的口径是「弹过通知但还没回来看」而不是侧栏的未读圆点：窗口在后面而你在跟前看的那一轮
// 也会弹通知，那一条同样值得在任务栏上提醒你。

import { join } from "node:path";
import { app, type BrowserWindow, nativeImage } from "electron";
import { AttentionSet, badgeAsset } from "./notify-policy.ts";

/** 徽标图目录：开发时在仓库里，打包后在 asar 的同一相对路径下（builder 的 files 收了 resources/）。 */
const ASSET_DIR = join(import.meta.dirname, "../../resources/taskbar");

export class TaskbarBadge {
	/** 主窗口晚于徽标服务创建，也可能会在 macOS 上重建：每次用都现取。 */
	private readonly target: () => BrowserWindow | null;
	/** 弹过通知、还没回来看的会话。 */
	private readonly attention = new AttentionSet();
	/** 当前要显示的数字（AttentionSet 的大小）。 */
	private count = 0;
	/** 已经画上去的数字；-1 表示还没画过（或换了窗口，需要重画）。 */
	private applied = -1;

	constructor(target: () => BrowserWindow | null) {
		this.target = target;
	}

	/** 某条会话弹出通知了：任务栏上多一条待看。 */
	mark(sessionId: string): void {
		this.attention.mark(sessionId);
		this.apply();
	}

	/** 用户回来看过这条会话了（窗口在前台且看的就是它）：摘掉那一条。 */
	attend(sessionId: string | null): void {
		this.attention.attend(sessionId);
		this.apply();
	}

	/** 窗口刚建出来（或重建过）：把当前数字重画到新窗口的任务栏按钮上。 */
	sync(): void {
		this.applied = -1;
		this.apply();
	}

	private apply(): void {
		this.count = this.attention.size;
		if (process.platform === "darwin") {
			if (this.count === this.applied) return;
			this.applied = this.count;
			app.dock?.setBadge(this.count === 0 ? "" : String(this.count));
			return;
		}
		if (process.platform !== "win32") return;
		const window = this.target();
		if (!window || window.isDestroyed()) return;
		if (this.count === this.applied) return;
		this.applied = this.count;
		const asset = badgeAsset(this.count);
		if (asset === null) {
			window.setOverlayIcon(null, "");
			return;
		}
		const image = nativeImage.createFromPath(join(ASSET_DIR, `${asset}.png`));
		// 图读不出来就当没有徽标：任务栏上挂个空图标比不画更奇怪。
		window.setOverlayIcon(image.isEmpty() ? null : image, `${this.count} session(s) need attention`);
	}
}
