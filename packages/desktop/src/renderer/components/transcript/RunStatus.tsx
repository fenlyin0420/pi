// 对话尾部的运行状态行：这一步在做什么、已经跑了多久，换一步就换一句。

import { useEffect, useState } from "react";
import type { RunActivity } from "../../../shared/contract.ts";
import { formatElapsed } from "../../lib/format.ts";

/** 思考时的说法，每换一步抽一条。 */
const THINKING_PHRASES = [
	"Thinking",
	"Pondering",
	"Mulling it over",
	"Working it out",
	"Considering",
	"Reasoning",
	"Turning it over",
	"Chewing on it",
];

/** 执行工具时的动词，后面接工具名。 */
const TOOL_VERBS = ["Running", "Executing", "Calling", "Using"];

type RunStatusProps = {
	activity: RunActivity;
	/** 这一步要播报的文案，由 `useStepPhrase` 算好——它得住在一个常驻的 live region 里。 */
	phrase: string;
};

/**
 * 运行状态行。挂在对话尾部、紧贴最后一轮内容：发送那一帧就有，整轮结束才消失。
 * 每一步（一段思考、一个工具）重新计时，所以读到的时长就是这一步自己的；
 * 换步换文案，所以每次都以新 key 重挂本体。
 */
export function RunStatus({ activity, phrase }: RunStatusProps) {
	return <RunStatusLine key={stepKey(activity)} activity={activity} phrase={phrase} />;
}

/** 一步的标识：换了动作、换了工具或重新计时，就是新的一步。 */
export function stepKey(activity: RunActivity): string {
	return `${activity.kind}:${activity.tool ?? ""}:${activity.startedAt}`;
}

/** 抽这一步的文案；避开上一步那句，换步骤时读起来就是真的换了。 */
export function pickPhrase(activity: RunActivity, previous: string | null): string {
	const pool =
		activity.kind === "thinking"
			? THINKING_PHRASES
			: TOOL_VERBS.map((verb) => `${verb} ${activity.tool ?? "the tool"}`);
	const candidates = pool.filter((phrase) => phrase !== previous);
	const options = candidates.length > 0 ? candidates : pool;
	return options[Math.floor(Math.random() * options.length)] ?? "";
}

/** 状态行本体：秒表每秒走一格，重渲染只发生在这个组件里，不牵动对话区。 */
function RunStatusLine({ activity, phrase }: { activity: RunActivity; phrase: string }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	// 起步那一刻显示 1s，而不是“跑了 0 秒”。
	const elapsed = formatElapsed(Math.max(1000, now - activity.startedAt));
	const label = `${phrase} for ${elapsed}`;
	// 整行对读屏隐藏：秒表每秒都在变，播报交给滚动区之外那句按步骤变化的常驻文案。
	return (
		<div className="run-status" aria-hidden>
			<span className="run-status-mark" />
			<span className="run-status-text">
				<span className="text-shimmer" data-active="true">
					<span className="text-shimmer-base">{label}</span>
					<span className="text-shimmer-peak">{label}</span>
				</span>
			</span>
			<span className="run-status-tail">···</span>
		</div>
	);
}
