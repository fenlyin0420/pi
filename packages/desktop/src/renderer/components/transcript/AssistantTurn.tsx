// assistant 的一轮回答：整轮的思考与工具折进一行活动链，正文一段段照常显示。

import { useMemo } from "react";
import type { TranscriptItem } from "../../../shared/contract.ts";
import { IconZap } from "../../icons.tsx";
import { layoutTurn } from "../../lib/turn-entries.ts";
import { cx } from "../../ui.tsx";
import { Markdown } from "../Markdown.tsx";
import { TurnActivity } from "./TurnActivity.tsx";
import { TurnMeta } from "./TurnMeta.tsx";

type AssistantTurnProps = {
	/** 一次提问之后的所有 loop，按时间顺序。 */
	items: readonly Extract<TranscriptItem, { kind: "assistant" }>[];
	showThinking: boolean;
	showUsage: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
};

/**
 * 一轮回答。整轮的思考与工具调用折进一条活动行（默认收起，运行中在标题上预览当前步骤），
 * 模型输出的正文按原顺序显示——中途的正文和最后一段一样正常露出。
 */
export function AssistantTurn({ items, showThinking, showUsage, showToolDetails, onOpenExternal }: AssistantTurnProps) {
	const entries = useMemo(() => layoutTurn(items, showThinking), [items, showThinking]);
	const running = items.some((item) => item.streaming);
	const last = items.at(-1);
	// 光标只跟在最后一段正文后面；活动行不是正文，不承载光标。
	const lastTextKey = entries.findLast((entry) => entry.kind === "text")?.key ?? null;
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
								running && entry.key === lastTextKey && "streaming",
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
							// 活动行排在最后一项才是“正在工作”；后面还有正文时，跑的是那段正文。
							running={running && index === entries.length - 1}
							showToolDetails={showToolDetails}
							onOpenExternal={onOpenExternal}
						/>
					),
				)}
				{last?.error ? <AssistantError error={last.error} /> : null}
				{showUsage && !running ? <TurnMeta usage={last?.usage ?? null} model={last?.model ?? null} /> : null}
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
