// 思考块：默认折叠，标题带推理摘要的首行，展开后显示原始推理文本。

import { useId, useState } from "react";
import { IconBrain, IconChevronRight } from "../../icons.tsx";
import { cx } from "../../ui.tsx";
import { Markdown } from "../Markdown.tsx";

type ThinkingBlockProps = {
	text: string;
	/** 这一块还在接收增量；运行中的标记和标题语气都由它决定。 */
	streaming: boolean;
	onOpenExternal: (url: string) => void;
};

/** 折叠的思考块；摘要取第一行非空内容，展开后按 markdown 渲染全文。 */
export function ThinkingBlock({ text, streaming, onOpenExternal }: ThinkingBlockProps) {
	const [open, setOpen] = useState(false);
	const detailsId = useId();
	const summary = firstLine(text);
	return (
		<div className={cx("tool-row", "thinking", open && "open")}>
			<button
				type="button"
				className="tool-row-header"
				aria-expanded={open}
				aria-controls={detailsId}
				aria-label={open ? "Hide thinking" : "Show thinking"}
				title={summary}
				onClick={() => setOpen(!open)}
			>
				<span className="tool-row-icon" aria-hidden>
					<IconBrain size={14} />
				</span>
				<span className={cx("tool-row-name", streaming && "running")}>{streaming ? "Thinking" : "Thought"}</span>
				{streaming ? <span className="activity-marker" aria-hidden /> : null}
				{summary ? <span className="tool-row-summary">{summary}</span> : null}
				<span className="tool-row-caret" aria-hidden>
					<IconChevronRight size={12} />
				</span>
			</button>
			{open ? (
				<div className="tool-row-body" id={detailsId}>
					<div className="prose-chat thinking-prose">
						<Markdown source={text} onOpenExternal={onOpenExternal} />
					</div>
				</div>
			) : null}
		</div>
	);
}

/** 摘要只取第一行非空内容；过长时截断，避免把思考开头整段搬到标题行。 */
function firstLine(text: string): string {
	const line =
		text
			.split("\n")
			.find((candidate) => candidate.trim() !== "")
			?.trim() ?? "";
	return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}
