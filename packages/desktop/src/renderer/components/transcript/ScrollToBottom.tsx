// 回到底部按钮：视图没有贴底、又有新内容时浮在对话区右下角。

import { IconArrowDown } from "../../icons.tsx";

/** 浮动的“回到底部”按钮，点击后重新贴底跟随。 */
export function ScrollToBottom({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			className="jump-latest-btn"
			aria-label="Scroll to latest message"
			title="Scroll to latest message"
			onClick={onClick}
		>
			<IconArrowDown size={14} />
		</button>
	);
}
