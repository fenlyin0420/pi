// assistant 的一轮回答：按 parts 顺序渲染文本、思考块与工具调用，末尾接用量行。

import { useMemo } from "react";
import type { AssistantPart, ToolCallView, TranscriptItem } from "../../../shared/contract.ts";
import { IconZap } from "../../icons.tsx";
import { cx } from "../../ui.tsx";
import { Markdown } from "../Markdown.tsx";
import { ActivityGroup } from "./ActivityGroup.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { ToolRow } from "./ToolRow.tsx";
import { TurnMeta } from "./TurnMeta.tsx";

type AssistantTurnProps = {
	item: Extract<TranscriptItem, { kind: "assistant" }>;
	showThinking: boolean;
	showUsage: boolean;
	showToolDetails: boolean;
	onOpenExternal: (url: string) => void;
};

/** 一轮回答；相邻的工具调用合成一组，单个工具直接占一行。 */
export function AssistantTurn({ item, showThinking, showUsage, showToolDetails, onOpenExternal }: AssistantTurnProps) {
	const segments = useMemo(() => buildSegments(item.parts), [item.parts]);
	// 光标只跟在真正还在生成的那段文本后面：工具调用接管了尾部就不再显示。
	const tail = segments.at(-1);
	const cursorKey = item.streaming && tail?.kind === "text" ? tail.key : null;
	return (
		<div className="message-row assistant">
			<div className="message-col">
				{segments.map((segment) => {
					if (segment.kind === "tools") {
						return segment.calls.length === 1 ? (
							<ToolRow key={segment.key} call={segment.calls[0]} showDetails={showToolDetails} />
						) : (
							<ActivityGroup key={segment.key} calls={segment.calls} showDetails={showToolDetails} />
						);
					}
					if (segment.kind === "thinking") {
						// 关掉“显示思考”后整块不渲染，也不留占位。
						if (!showThinking) return null;
						return (
							<ThinkingBlock
								key={segment.key}
								text={segment.text}
								streaming={item.streaming && segment === tail}
								onOpenExternal={onOpenExternal}
							/>
						);
					}
					return (
						<div
							key={segment.key}
							className={cx(
								"message-bubble",
								"assistant-turn-fragment",
								segment.key === cursorKey && "streaming",
							)}
						>
							<div className="prose-chat">
								<Markdown source={segment.text} onOpenExternal={onOpenExternal} />
							</div>
						</div>
					);
				})}
				{item.error ? <AssistantError error={item.error} /> : null}
				{showUsage && !item.streaming ? <TurnMeta usage={item.usage} model={item.model} /> : null}
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

type Segment =
	| { kind: "text"; key: string; text: string }
	| { kind: "thinking"; key: string; text: string }
	| { kind: "tools"; key: string; calls: ToolCallView[] };

/**
 * 把 parts 折成渲染单元：空文本跳过，相邻的工具调用并进同一组。
 * key 用该单元第一个 part 的下标，parts 只追加不改位，同一段内容始终拿到同一个 key。
 */
function buildSegments(parts: readonly AssistantPart[]): Segment[] {
	const segments: Segment[] = [];
	for (const [index, part] of parts.entries()) {
		const last = segments.at(-1);
		if (part.type === "tool") {
			if (last?.kind === "tools") last.calls.push(part.call);
			else segments.push({ kind: "tools", key: `tools-${index}`, calls: [part.call] });
			continue;
		}
		if (part.text === "") continue;
		segments.push({
			kind: part.type,
			key: `${part.type}-${index}`,
			text: part.text,
		});
	}
	return segments;
}
