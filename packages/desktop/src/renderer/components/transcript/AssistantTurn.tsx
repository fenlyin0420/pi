// assistant 的一轮回答：整轮的思考与工具折进一行活动链，正文一段段照常显示。

import { useMemo } from "react";
import type { TranscriptItem } from "../../../shared/contract.ts";
import { IconZap } from "../../icons.tsx";
import { formatClock } from "../../lib/format.ts";
import { layoutTurn } from "../../lib/turn-entries.ts";
import { cx } from "../../ui.tsx";
import { Markdown } from "../Markdown.tsx";
import { TurnActivity } from "./TurnActivity.tsx";
import { TurnMeta } from "./TurnMeta.tsx";

type AssistantTurnProps = {
	/** 一次提问之后的所有 loop，按时间顺序。 */
	items: readonly Extract<TranscriptItem, { kind: "assistant" }>[];
	/** 这是最后一轮、且这一轮还没跑完：预览行接着动，用量条先不露。 */
	live: boolean;
	showThinking: boolean;
	showUsage: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
};

/**
 * 一轮回答。整轮的思考与工具调用折进一条活动行（默认收起，运行中在标题上预览当前步骤），
 * 模型输出的正文按原顺序显示——中途的正文和最后一段一样正常露出。
 */
export function AssistantTurn({
	items,
	live,
	showThinking,
	showUsage,
	showToolDetails,
	onOpenExternal,
}: AssistantTurnProps) {
	const entries = useMemo(() => layoutTurn(items, showThinking), [items, showThinking]);
	// 正文还在流式才亮光标：中途跑工具时没有流式正文，光标得减。
	const streaming = items.some((item) => item.streaming);
	const last = items.at(-1);
	// 光标只跟在最后一段正文后面；活动行不是正文，不承载光标。
	const lastTextKey = entries.findLast((entry) => entry.kind === "text")?.key ?? null;
	// 运行中的预览只挂在最后一条活动行上：一轮没跑完（包括正在跑工具那段）就一直预览当前这一步，
	// 不退回静态摘要；整轮结束才收起折叠行、露出耗时和用量。
	const previewIndex = live ? entries.findLastIndex((entry) => entry.kind === "activity") : -1;
	return (
		<div className="message-row assistant">
			<div className="message-col">
				{entries.map((entry, index) =>
					entry.kind === "text" ? (
						<div
							key={entry.key}
							className={cx(
								"message-bubble",
								"assistant-turn-fragment",
								streaming && entry.key === lastTextKey && "streaming",
							)}
						>
							<div className="prose-chat">
								<Markdown source={entry.text} onOpenExternal={onOpenExternal} />
							</div>
						</div>
					) : (
						<TurnActivity
							key={entry.key}
							blocks={entry.blocks}
							running={index === previewIndex}
							showToolDetails={showToolDetails}
							onOpenExternal={onOpenExternal}
						/>
					),
				)}
				{last?.error ? <AssistantError error={last.error} /> : null}
				{/*
				  用量条和悬浮时间都属于“这一轮交回去了、在等你输入”的时刻。跑的过程中只留文案（尾部状态行），
				  连 message-actions 那行悬停位也不占：它空着还有 24px 高，会把状态行又顶下去一截。
				*/}
				{live ? null : (
					<>
						{showUsage ? <TurnMeta usage={last?.usage ?? null} model={last?.model ?? null} /> : null}
						<div className="message-actions">
							<span className="message-timestamp">{last ? formatClock(last.timestamp) : ""}</span>
						</div>
					</>
				)}
			</div>
		</div>
	);
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
