// 一段思考：默认折成一行标题，点开才铺出正文。

import { useId, useState } from "react";
import { IconChevronRight } from "../../icons.tsx";
import { cx } from "../../ui.tsx";
import { Markdown } from "../Markdown.tsx";

type ThinkingFoldProps = {
	text: string;
	onOpenExternal: (url: string) => void;
};

/**
 * 活动链里的一段思考。默认收起：一段思考常比它周围的工具调用长得多，默认铺开会把整条
 * 过程撑满，翻工具结果时要先跨过好几屏。标题只报「Thought」，箭头紧跟标题。
 */
export function ThinkingFold({ text, onOpenExternal }: ThinkingFoldProps) {
	const [open, setOpen] = useState(false);
	const bodyId = useId();
	return (
		<div className={cx("thinking-fold", open && "open")}>
			<button
				type="button"
				className="thinking-fold-header"
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={() => setOpen(!open)}
			>
				<span className="thinking-fold-label">Thought</span>
				<span className="thinking-fold-caret" aria-hidden>
					<IconChevronRight size={12} />
				</span>
			</button>
			{open ? (
				<div className="thinking-fold-body prose-chat thinking-prose" id={bodyId}>
					<Markdown source={text} onOpenExternal={onOpenExternal} />
				</div>
			) : null}
		</div>
	);
}
