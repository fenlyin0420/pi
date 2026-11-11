// assistant 的一轮回答：整轮过程折进一行活动链，只留最后一段模型输出，末尾接用量行。

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
 * 一轮回答。整轮的思考、工具调用和中途草稿折进一条活动行（默认收起，运行中在标题上
 * 预览当前步骤），下面只留最后一个 loop 的模型输出。
 */
export function AssistantTurn({ items, showThinking, showUsage, showToolDetails, onOpenExternal }: AssistantTurnProps) {
	const { activity, output } = useMemo(() => layoutTurn(items, showThinking), [items, showThinking]);
	const last = items.at(-1);
	const running = items.some((item) => item.streaming);
	return (
		<div className="message-row assistant">
			<div className="message-col">
				{activity.length > 0 ? (
					<TurnActivity
						entries={activity}
						running={running}
						showToolDetails={showToolDetails}
						onOpenExternal={onOpenExternal}
					/>
				) : null}
				{output ? (
					<div className={cx("message-bubble", "assistant-turn-fragment", running && "streaming")}>
						<div className="prose-chat">
							<Markdown source={output.text} onOpenExternal={onOpenExternal} />
						</div>
					</div>
				) : null}
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
