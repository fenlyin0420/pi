// 沉浸模式的舞台：顶部细栏管这份文档，中间是产物帧（还没有产物时是入口页），底部是这一模式的唯一输入口。
// 这一轮的用户消息与它的附件由宿主固定显示在帧上方，不依赖模型在页面里回显。

import { useMemo, useState } from "react";
import type { AgentStatus, TranscriptItem } from "../../../shared/contract.ts";
import { IconChevronDown, IconClose, IconCopy, IconMaximize, IconRefresh } from "../../icons.tsx";
import { artifactSource, artifactTurns, turnHasArtifact } from "../../lib/artifact.ts";
import { cx } from "../../ui.tsx";
import { MessageAttachments } from "../transcript/MessageAttachments.tsx";
import { ArtifactFrame } from "./ArtifactFrame.tsx";
import { ArtifactOverlay } from "./ArtifactOverlay.tsx";
import { StageComposer } from "./StageComposer.tsx";

/** 本轮没有页面时的重试话术：固定文案，不替用户猜该做什么。 */
const RETRY_PROMPT = "Render the page again: call render_html once with the complete, self-contained HTML document.";

/** 入口页给的三句话：写进去当草稿，不直接发出去，用户还能改。 */
const ENTRY_EXAMPLES = [
	"A counter with plus and minus buttons",
	"A dashboard of this week's commits",
	"A form I can fill in and submit",
];

type ArtifactStageProps = {
	sessionId: string;
	/** 会话标题，写在顶部细栏里。 */
	title: string;
	items: readonly TranscriptItem[];
	theme: "dark" | "light";
	status: AgentStatus;
	onSubmit: (text: string) => void;
	onSteer: (text: string) => void;
	onAbort: () => void;
	onOpenExternal: (url: string) => void;
	onExit: () => void;
};

/**
 * 舞台不显示对话：最新的产物占满中间，运行中盖一条提示条而不换帧，
 * 所以模型写半截时上一版还在，交互不会被抖掉。流式中的产物不进列表（见 artifactTurns）。
 */
export function ArtifactStage({
	sessionId,
	title,
	items,
	theme,
	status,
	onSubmit,
	onSteer,
	onAbort,
	onOpenExternal,
	onExit,
}: ArtifactStageProps) {
	// 最新的排在最前面：下拉里第一项就是“这一轮”。
	const turns = useMemo(() => artifactTurns(items).reverse(), [items]);
	const currentTurnHasArtifact = useMemo(() => turnHasArtifact(items), [items]);
	const latestId = turns[0]?.artifact.id ?? null;
	// 翻到哪一轮是按“最新一份”记住的：新的一份到了就自动回到本轮，不会停在旧版本上。
	const [selection, setSelection] = useState<{ latestId: string | null; offset: number }>({
		latestId: null,
		offset: 0,
	});
	const [mode, setMode] = useState<"preview" | "source">("preview");
	const [fullscreen, setFullscreen] = useState(false);
	const [copied, setCopied] = useState(false);
	const [draft, setDraft] = useState("");

	const offset = selection.latestId === latestId ? selection.offset : 0;
	const current = turns[offset] ?? null;
	const artifact = current?.artifact ?? null;
	const source = artifact === null ? null : artifactSource(artifact);

	async function copySource(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1_200);
		} catch {
			// 剪贴板不可用（权限、非安全上下文）就当作没按：源码视图里本来就能选中复制。
		}
	}

	return (
		<div className="artifact-stage">
			<div className="artifact-stage-bar">
				<span className="artifact-stage-title" title={title}>
					{title}
				</span>
				{turns.length > 1 ? (
					<label className="artifact-stage-turns">
						<span className="sr-only">Turn</span>
						<select
							value={offset}
							onChange={(event) => setSelection({ latestId, offset: Number(event.target.value) })}
							aria-label="Choose a turn"
						>
							{turns.map((turn, index) => (
								<option key={turn.artifact.id} value={index}>
									{turnLabel(index)}
								</option>
							))}
						</select>
						<IconChevronDown size={12} aria-hidden="true" />
					</label>
				) : null}
				<div className="artifact-stage-actions">
					{artifact !== null && source !== null ? (
						<>
							<button
								type="button"
								className={cx("artifact-stage-btn", mode === "source" && "active")}
								aria-pressed={mode === "source"}
								onClick={() => setMode(mode === "source" ? "preview" : "source")}
							>
								{mode === "source" ? "Preview" : "Source"}
							</button>
							{mode === "source" ? (
								<button
									type="button"
									className="icon-btn"
									aria-label="Copy source"
									title={copied ? "Copied" : "Copy source"}
									onClick={() => void copySource(source)}
								>
									<IconCopy size={13} aria-hidden="true" />
								</button>
							) : null}
							<button
								type="button"
								className="icon-btn"
								aria-label="Full screen"
								title="Full screen"
								onClick={() => setFullscreen(true)}
							>
								<IconMaximize size={13} aria-hidden="true" />
							</button>
						</>
					) : null}
					<button
						type="button"
						className="icon-btn artifact-stage-exit"
						aria-label="Leave immersive mode"
						title="Leave immersive mode"
						onClick={onExit}
					>
						<IconClose size={14} aria-hidden="true" />
					</button>
				</div>
			</div>
			{artifact !== null && !currentTurnHasArtifact && status === "idle" ? (
				<div className="artifact-stage-notice">
					<span>No HTML this turn.</span>
					<button type="button" onClick={() => onSubmit(RETRY_PROMPT)}>
						<IconRefresh size={12} aria-hidden="true" />
						Retry
					</button>
				</div>
			) : null}
			<div className="artifact-stage-body">
				{artifact === null ? (
					<div className="artifact-stage-entry">
						<div className="artifact-stage-entry-inner">
							<span className="artifact-stage-entry-badge">Immersive mode</span>
							<h2 className="artifact-stage-entry-title">Describe the page you want.</h2>
							<p className="artifact-stage-entry-hint">
								The model answers with an interactive page. From then on you keep the conversation in the box
								below, and every reply becomes a new version of it.
							</p>
							<div className="artifact-stage-entry-examples">
								{ENTRY_EXAMPLES.map((example) => (
									<button type="button" key={example} onClick={() => setDraft(example)}>
										{example}
									</button>
								))}
							</div>
						</div>
					</div>
				) : (
					<div className="artifact-stage-page">
						{current?.prompt ? (
							<div className="artifact-stage-echo">
								<span className="artifact-stage-echo-label">You</span>
								<div className="artifact-stage-echo-body">
									{current.prompt.text ? (
										<p className="artifact-stage-echo-text selectable">{current.prompt.text}</p>
									) : null}
									<MessageAttachments item={current.prompt} sessionId={sessionId} />
								</div>
							</div>
						) : null}
						{mode === "source" ? (
							<pre className="artifact-source">{source}</pre>
						) : (
							<ArtifactFrame
								// 换一份文档或换主题就整帧重挂：旧页面的状态、定时器、全局变量都不该漏到下一版里。
								key={`${artifact.id}-${theme}`}
								sessionId={sessionId}
								itemId={artifact.id}
								title={artifact.title}
								theme={theme}
								onSubmit={onSubmit}
								onOpenExternal={onOpenExternal}
							/>
						)}
					</div>
				)}
				{status === "running" ? (
					<output className="artifact-working">
						<span className="spinner" aria-hidden="true" />
						Working…
					</output>
				) : null}
			</div>
			<StageComposer
				value={draft}
				onValue={setDraft}
				status={status}
				onSubmit={onSubmit}
				onSteer={onSteer}
				onAbort={onAbort}
				autoFocus={artifact === null}
			/>
			{fullscreen && artifact !== null ? (
				<ArtifactOverlay
					sessionId={sessionId}
					artifact={artifact}
					theme={theme}
					onSubmit={onSubmit}
					onOpenExternal={onOpenExternal}
					onClose={() => setFullscreen(false)}
				/>
			) : null}
		</div>
	);
}

/** 下拉里的轮次名：0 是这一轮，1 是上一轮，再往前数数。 */
function turnLabel(offset: number): string {
	if (offset === 0) return "This turn";
	if (offset === 1) return "Previous turn";
	return `${offset} turns ago`;
}
