// assistant 的一轮回答：按 parts 顺序渲染文本、思考块与工具调用，末尾接用量行。

import { useMemo } from "react";
import type { TranscriptItem } from "../../../shared/contract.ts";
import { IconZap } from "../../icons.tsx";
import { buildTurnEntries, type TurnEntry } from "../../lib/turn-entries.ts";
import { cx } from "../../ui.tsx";
import { Markdown } from "../Markdown.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { ToolRow } from "./ToolRow.tsx";
import { TurnActivity } from "./TurnActivity.tsx";
import { TurnMeta } from "./TurnMeta.tsx";

type AssistantTurnProps = {
	item: Extract<TranscriptItem, { kind: "assistant" }>;
	showThinking: boolean;
	showUsage: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
};

/**
 * 一轮回答。文本照旧分段成气泡；相邻的思考与工具调用并成一条活动链，
 * 只有整轮只有一环（一次工具调用或一段思考）时才直接铺开那一环。
 */
export function AssistantTurn({ item, showThinking, showUsage, showToolDetails, onOpenExternal }: AssistantTurnProps) {
	const entries = useMemo(() => buildTurnEntries(item.parts, showThinking), [item.parts, showThinking]);
	// 光标和“正在运行”只落在最后一个渲染单元上：它才是这轮正在吐出的那一段。
	const liveKey = item.streaming ? (entries.at(-1)?.key ?? null) : null;
	return (
		<div className="message-row assistant">
			<div className="message-col">
				{entries.map((entry) => renderEntry(entry, entry.key === liveKey, showToolDetails, onOpenExternal))}
				{item.error ? <AssistantError error={item.error} /> : null}
				{showUsage && !item.streaming ? <TurnMeta usage={item.usage} model={item.model} /> : null}
			</div>
		</div>
	);
}

/** 一个渲染单元；live 表示它正接着增量。 */
function renderEntry(entry: TurnEntry, live: boolean, showToolDetails: boolean, onOpenExternal: (url: string) => void) {
	switch (entry.kind) {
		case "thinking":
			return <ThinkingBlock key={entry.key} text={entry.text} streaming={live} onOpenExternal={onOpenExternal} />;
		case "tool":
			return <ToolRow key={entry.key} call={entry.call} showDetails={showToolDetails} />;
		case "activity":
			return (
				<TurnActivity
					key={entry.key}
					blocks={entry.blocks}
					streaming={live}
					showToolDetails={showToolDetails}
					onOpenExternal={onOpenExternal}
				/>
			);
		case "text":
			return (
				<div key={entry.key} className={cx("message-bubble", "assistant-turn-fragment", live && "streaming")}>
					<div className="prose-chat">
						<Markdown source={entry.text} onOpenExternal={onOpenExternal} />
					</div>
				</div>
			);
	}
}

/** 一轮失败的原因；错误文本可能很长，块内自己滚动。 */
function AssistantError({ error }: { error: string }) {
	return (
		<div className="message-error" role="alert">
			<div className="message-error-heading">
				<span className="message-error-icon" aria-hidden>
					<IconZap size={13} />
				</span>
				<div className="message-error-copy">
					<strong>Model error</strong>
				</div>
			</div>
			<div className="message-error-details">
				<pre>{error}</pre>
			</div>
		</div>
	);
}
