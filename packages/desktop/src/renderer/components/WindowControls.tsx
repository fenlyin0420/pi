// 无边框窗口的最小化/最大化/关闭按钮，画成 macOS 的红绿灯：静止时只有三颗圆点，鼠标
// 进入这一组才浮出图标。它们和标题栏在同一棵 DOM 里，所以对话框遮罩、主题色和 hover
// 都能盖到——系统绘制的 Window Controls Overlay 做不到这一点。

import { IconClose, IconCopy, IconMaximize, IconMinus } from "../icons.tsx";
import { IconButton } from "../ui.tsx";

/** 渲染三颗红绿灯；maximized 时中间那颗换成还原图标，点击仍发同一个命令。 */
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
			<IconButton label="Minimize" className="window-control window-control-minimize" onClick={onMinimize}>
				<IconMinus size={9} />
			</IconButton>
			<IconButton
				label={maximized ? "Restore" : "Maximize"}
				className="window-control window-control-maximize"
				onClick={onMaximize}
			>
				{maximized ? <IconCopy size={8} /> : <IconMaximize size={8} />}
			</IconButton>
			<IconButton label="Close" className="window-control window-control-close" onClick={onClose}>
				<IconClose size={9} />
			</IconButton>
		</div>
	);
}
