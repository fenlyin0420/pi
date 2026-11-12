// 对话尾部的运行状态行：模型还在跑就一直亮着，文案与具体步骤无关，秒表是这一轮的总时长。

import { useEffect, useState } from "react";
import type { RunActivity } from "../../../shared/contract.ts";
import { formatElapsed } from "../../lib/format.ts";
import { ShimmerText } from "../../ui.tsx";

/** 状态行自己的用词：不指向任何一种具体动作（不说 thinking/reading 这类），只表示还在跑。 */
const WORKING_PHRASES = [
	"Working",
	"Tinkering",
	"Noodling",
	"Churning",
	"Simmering",
	"Brewing",
	"Puttering",
	"Chugging",
	"Plugging away",
	"Getting there",
];

/** 每隔几秒换一句：一行字长时间不变，看着就像卡住了。 */
const PHRASE_SECONDS = 8;

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

/**
 * 运行状态行。挂在对话尾部、紧贴最后一轮内容：发送那一帧就有，整轮结束才消失。
 * 秒表从它出现那一刻起算，整轮只增不减；文案定期换一句，与当前步骤无关——
 * 具体在做什么由上面那条活动行预览，两者不必对得上。
 */
export function RunStatus() {
	const [startedAt] = useState(() => Date.now());
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setTick((next) => next + 1), 1000);
		return () => clearInterval(timer);
	}, []);
	// 起步那一刻显示 1s，而不是“跑了 0 秒”。
	const elapsed = formatElapsed(Math.max(1000, Date.now() - startedAt));
	const label = `${workingPhrase(tick)} for ${elapsed}`;
	// 整行对读屏隐藏：秒表每秒都在变，播报交给滚动区之外那句按步骤变化的常驻文案。
	return (
		<div className="run-status" aria-hidden>
			<span className="run-status-mark" />
			<span className="run-status-text">
				<ShimmerText text={label} />
			</span>
			<span className="run-status-tail">···</span>
		</div>
	);
}

/** 第 `tick` 秒该说哪一句：按顺序轮，轮完一圈从头来。 */
export function workingPhrase(tick: number): string {
	const index = Math.floor(tick / PHRASE_SECONDS) % WORKING_PHRASES.length;
	return WORKING_PHRASES[index] ?? "";
}

/** 一步的标识：换了动作、换了工具或重新计时，就是新的一步。 */
export function stepKey(activity: RunActivity): string {
	return `${activity.kind}:${activity.tool ?? ""}:${activity.startedAt}`;
}

/** 抽这一步的播报文案；避开上一步那句，换步骤时读起来就是真的换了。 */
export function pickPhrase(activity: RunActivity, previous: string | null): string {
	const pool =
		activity.kind === "thinking"
			? THINKING_PHRASES
			: TOOL_VERBS.map((verb) => `${verb} ${activity.tool ?? "the tool"}`);
	const candidates = pool.filter((phrase) => phrase !== previous);
	const options = candidates.length > 0 ? candidates : pool;
	return options[Math.floor(Math.random() * options.length)] ?? "";
}
