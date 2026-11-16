// 沉浸模式的输入条：主栏唯一的输入口，回车发出（运行中变成排队），Shift+回车换行。

import { useEffect, useRef } from "react";
import type { AgentStatus } from "../../../shared/contract.ts";
import { IconSend, IconStop } from "../../icons.tsx";

type StageComposerProps = {
	value: string;
	onValue: (text: string) => void;
	status: AgentStatus;
	/** 空闲时发一条新消息。 */
	onSubmit: (text: string) => void;
	/** 运行中发一条排队消息（下一轮之前的 steer）。 */
	onSteer: (text: string) => void;
	onAbort: () => void;
	autoFocus?: boolean;
};

/** 底部的输入条：视觉上跟对话区的 composer 同一套语言，但只承担“说下一句”。 */
export function StageComposer({ value, onValue, status, onSubmit, onSteer, onAbort, autoFocus }: StageComposerProps) {
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const running = status === "running";

	// 高度跟着内容走：一行起步，到 160px 封顶，超出的部分自己滚。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 高度要随 value 重算，value 本身不参与计算
	useEffect(() => {
		const node = inputRef.current;
		if (!node) return;
		node.style.height = "auto";
		node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
	}, [value]);

	const send = () => {
		const text = value.trim();
		if (text === "") return;
		onValue("");
		if (running) onSteer(text);
		else onSubmit(text);
	};

	return (
		<div className="stage-composer">
			<div className="stage-composer-field">
				<textarea
					ref={inputRef}
					className="stage-composer-input"
					rows={1}
					value={value}
					placeholder={running ? "Queue the next message…" : "Ask for a change to this page…"}
					aria-label="Message"
					// biome-ignore lint/a11y/noAutofocus: the stage is the only input surface in this mode.
					autoFocus={autoFocus}
					onChange={(event) => onValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter" || event.shiftKey) return;
						event.preventDefault();
						send();
					}}
				/>
				<div className="stage-composer-actions">
					{running ? (
						<button type="button" className="icon-btn" aria-label="Stop" title="Stop" onClick={onAbort}>
							<IconStop size={14} aria-hidden="true" />
						</button>
					) : null}
					<button
						type="button"
						className="stage-composer-send"
						aria-label={running ? "Queue message" : "Send message"}
						title={running ? "Queue message" : "Send"}
						disabled={value.trim() === ""}
						onClick={send}
					>
						<IconSend size={14} aria-hidden="true" />
					</button>
				</div>
			</div>
			<div className="stage-composer-hint">
				{running ? "Enter queues for the next turn" : "Enter sends · Shift+Enter for a new line"}
			</div>
		</div>
	);
}
