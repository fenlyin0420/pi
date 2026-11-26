// 一条消息的复制按钮：把整段纯文本写进剪贴板，图标和文字短暂换成“已复制”。

import { useEffect, useState } from "react";
import { IconCheck, IconCopy } from "../../icons.tsx";
import { cx } from "../../ui.tsx";

/** 复制成功后高亮多久；到点自己收回去，再点还能复制一次。 */
const COPIED_MS = 1500;

type CopyMessageButtonProps = {
	text: string;
	/** 可访问标签和原生 tooltip，例如“Copy message”。 */
	label: string;
};

/** 整条消息的一键复制；空文本不该渲染这个按钮，由调用点判断。 */
export function CopyMessageButton({ text, label }: CopyMessageButtonProps) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
		return () => window.clearTimeout(timer);
	}, [copied]);

	const title = copied ? "Copied" : label;
	return (
		<button
			type="button"
			className={cx("copy-btn", copied && "copied")}
			title={title}
			aria-label={title}
			onClick={() => {
				void navigator.clipboard.writeText(text).then(() => setCopied(true));
			}}
		>
			{copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
			<span>{copied ? "Copied" : "Copy"}</span>
		</button>
	);
}
