// 工具卡片：一行标题（图标、工具名、摘要、状态）+ 展开后的参数、diff、todo 清单和结果。

import { type ReactNode, useId, useMemo, useState } from "react";
import type { ToolCallView } from "../../../shared/contract.ts";
import {
	IconChevronRight,
	IconFile,
	IconFolder,
	IconListTodo,
	IconPencil,
	IconSearch,
	IconSparkles,
	IconTerminal,
	IconZap,
} from "../../icons.tsx";
import { diffLines } from "../../lib/diff.ts";
import { formatDuration } from "../../lib/format.ts";
import { todoProgress } from "../../lib/todo.ts";
import { cx } from "../../ui.tsx";
import { TodoCard } from "./TodoCard.tsx";

type ToolRowProps = {
	call: ToolCallView;
	/** 界面偏好：展开的工具卡片默认就直接摊开。 */
	showDetails: boolean;
};

/** 一次工具调用；点标题展开参数、diff 与结果。 */
export function ToolRow({ call, showDetails }: ToolRowProps) {
	// null 表示还没有用户选择，此时跟着偏好走；点过之后以自己的选择为准。
	const [choice, setChoice] = useState<boolean | null>(null);
	const detailsId = useId();
	const hasDetails = call.argsText !== "" || call.resultText !== "" || call.diff !== null || call.todo !== null;
	const open = hasDetails && (choice ?? showDetails);
	const state = toolState(call);
	const progress = call.todo ? todoProgress(call.todo.tasks) : null;
	return (
		<div className={cx("tool-row", open && "open", `status-${call.state}`)}>
			<button
				type="button"
				className="tool-row-header"
				aria-expanded={open}
				aria-controls={hasDetails ? detailsId : undefined}
				disabled={!hasDetails}
				title={call.summary}
				onClick={() => setChoice(!open)}
			>
				<span className="tool-row-icon" aria-hidden>
					{toolIcon(call.name)}
				</span>
				<span className={cx("tool-row-name", call.state === "running" && "running")}>{call.name}</span>
				{call.state === "running" ? <span className="activity-marker" aria-hidden /> : null}
				<span className="tool-row-summary">{summaryWithoutName(call)}</span>
				{progress ? (
					<span className="tool-row-count">
						{progress.done}/{progress.total}
					</span>
				) : null}
				{state ? (
					<span className={cx("tool-row-state", `is-${state.tone}`)}>
						<span className="tool-row-state-dot" aria-hidden />
						{state.label}
					</span>
				) : null}
				{hasDetails ? (
					<span className="tool-row-caret" aria-hidden>
						<IconChevronRight size={12} />
					</span>
				) : null}
			</button>
			{open ? (
				<div className="tool-row-body" id={detailsId}>
					{call.todo ? <TodoCard todo={call.todo} /> : null}
					{call.diff ? <ToolDiff diff={call.diff} /> : null}
					{call.argsText && !call.todo ? (
						<div className="tool-block">
							<div className="tool-row-section-head">
								<span>Arguments</span>
							</div>
							<pre className="tool-row-content">{call.argsText}</pre>
						</div>
					) : null}
					{call.resultText && !call.todo ? (
						<div className="tool-block">
							<div className="tool-row-section-head">
								<span>Result</span>
							</div>
							<pre className={cx("tool-row-content", call.state === "error" && "is-error")}>
								{call.resultText}
							</pre>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/** 展开体里的逐行 diff；只给增删行染色，不做行号对齐。 */
function ToolDiff({ diff }: { diff: { path: string; before: string; after: string } }) {
	const lines = useMemo(() => diffLines(diff.before, diff.after), [diff]);
	return (
		<div className="tool-block">
			<div className="tool-row-section-head">
				<span>Diff</span>
				<span>{diff.path}</span>
			</div>
			<div className="tool-diff">
				{lines.map((line, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: diff 行的顺序就是它的身份，重排时内容也跟着变
					<div key={index} className={cx("diff-line", line.kind)}>
						<span className="diff-line-sign" aria-hidden>
							{signOf(line.kind)}
						</span>
						<span className="diff-line-text">{line.text || " "}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function signOf(kind: "same" | "add" | "remove"): string {
	if (kind === "add") return "+";
	if (kind === "remove") return "-";
	return " ";
}

/** 状态徽标的文字与配色；没有可说的状态（已完成且没计到耗时）返回 null。 */
function toolState(call: ToolCallView): { label: string; tone: "done" | "running" | "error" | "pending" } | null {
	switch (call.state) {
		case "running":
			return { label: "running", tone: "running" };
		case "pending":
			return { label: "queued", tone: "pending" };
		case "error":
			return { label: "failed", tone: "error" };
		case "done": {
			const duration = formatDuration(call.durationMs);
			return duration ? { label: duration, tone: "done" } : null;
		}
	}
}

/** 摘要已经带了工具名（`bash npm test`），这里去掉前缀，标题行才不会重复。 */
function summaryWithoutName(call: ToolCallView): string {
	const prefix = `${call.name} `;
	return call.summary.startsWith(prefix) ? call.summary.slice(prefix.length) : call.summary;
}

/** 按工具种类挑图标；未知工具用通用标记。 */
function toolIcon(name: string): ReactNode {
	switch (name) {
		case "bash":
		case "shell":
		case "run":
			return <IconTerminal size={14} />;
		case "edit":
		case "write":
		case "apply_patch":
			return <IconPencil size={14} />;
		case "read":
			return <IconFile size={14} />;
		case "ls":
		case "list":
		case "glob":
			return <IconFolder size={14} />;
		case "grep":
		case "find":
		case "web_search":
			return <IconSearch size={14} />;
		case "todo":
			return <IconListTodo size={14} />;
		case "web_fetch":
		case "fetch":
			return <IconZap size={14} />;
		default:
			return <IconSparkles size={14} />;
	}
}
