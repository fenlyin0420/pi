// 无边框窗口的最小化/最大化/关闭按钮；macOS 自带红绿灯，这里只服务 win32 和 linux。

import { IconClose, IconCopy, IconMaximize, IconMinimize } from "../icons.tsx";
import { cx, IconButton } from "../ui.tsx";

/** 渲染三个窗口按钮；maximized 时中间那颗换成还原图标，点击仍发同一个命令。 */
export function WindowControls({
	maximized,
	onMinimize,
	onMaximize,
	onClose,
}: {
	maximized: boolean;
	onMinimize: () => void;
	onMaximize: () => void;
	onClose: () => void;
}) {
	return (
		<div className="window-controls">
			<IconButton label="Minimize" className="window-control" onClick={onMinimize}>
				<IconMinimize size={13} />
			</IconButton>
			<IconButton
				label={maximized ? "Restore" : "Maximize"}
				className={cx("window-control", maximized && "is-maximized")}
				onClick={onMaximize}
			>
				{maximized ? <IconCopy size={12} /> : <IconMaximize size={12} />}
			</IconButton>
			<IconButton label="Close" className="window-control window-control-close" onClick={onClose}>
				<IconClose size={13} />
			</IconButton>
		</div>
	);
}
