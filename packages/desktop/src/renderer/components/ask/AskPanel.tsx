// ask_user 的作答卡片：贴在输入框上方，一张卡只问当前这一道题。
// 它不是弹窗：没有遮罩、不抓焦点，点卡片外面关不掉；只有 X（或 pi-ask 自己结束这次提问）才收起。
// 卡片只渲染当前会话的提问：别的会话还在等时只靠侧栏那一行的空心点提醒，切回去才重新画出来。

import { useEffect, useMemo, useState } from "react";
import type { AskAnswer, AskQuestionView, AskRequest } from "../../../shared/contract.ts";
import { IconClose } from "../../icons.tsx";
import { Button, cx, IconButton } from "../../ui.tsx";

/** 一道题的草稿：选中的选项值和自填正文。 */
type Draft = { values: string[]; customText: string };

/** 没碰过的题共用一份空草稿：内容不可变，省掉每题一个对象。 */
const EMPTY_DRAFT: Draft = { values: [], customText: "" };

/**
 * 草稿按 flowId 键控存在模块里：卡片按会话隐藏时会卸载，切回去再答时不该回到白纸。
 * 数据层持有，UI 只负责显示；提问一结束就由 AskDock 剔掉。
 */
const draftCache = new Map<string, { drafts: Record<string, Draft>; note: string }>();

/** 删掉已经不在等回答的那些草稿，避免长时间开着攒一堆。 */
export function forgetAskDrafts(liveFlowIds: ReadonlySet<string>): void {
	for (const flowId of draftCache.keys()) {
		if (!liveFlowIds.has(flowId)) draftCache.delete(flowId);
	}
}

type AskPanelProps = {
	request: AskRequest;
	onSubmit: (answers: Record<string, AskAnswer>, note: string) => void;
	/** 关掉这次提问而不作答：pi-ask 会把它当成用户取消。 */
	onCancel: () => void;
};

/** 一道题算不算答过：选了选项，或填了自己那一句。 */
function isAnswered(draft: Draft | undefined): boolean {
	if (!draft) return false;
	return draft.values.length > 0 || draft.customText.trim() !== "";
}

/** 一张提问卡片。草稿留在本地，切题、切会话都不丢。 */
export function AskPanel({ request, onSubmit, onCancel }: AskPanelProps) {
	const questions = request.questions;
	const cached = draftCache.get(request.flowId);
	const [drafts, setDrafts] = useState<Record<string, Draft>>(cached?.drafts ?? {});
	const [note, setNote] = useState(cached?.note ?? "");
	const [activeIndex, setActiveIndex] = useState(0);
	const [confirming, setConfirming] = useState(false);

	// 草稿写回模块缓存：切会话、切题都不会丢，重新挂载时直接读回去。
	useEffect(() => {
		draftCache.set(request.flowId, { drafts, note });
	}, [request.flowId, drafts, note]);

	const index = Math.min(activeIndex, questions.length - 1);
	// main 侧已经拦掉空题目（toAskRequest 至少一题），所以这个下标永远命中。
	const current = questions[index] as AskQuestionView;
	const draft = drafts[current.id] ?? EMPTY_DRAFT;
	// 必答题都答过才能提交；选答题可以空着走。
	const ready = useMemo(
		() => questions.every((question) => !question.required || isAnswered(drafts[question.id])),
		[questions, drafts],
	);
	// 有任何改动就先问一句再关：选好的答案不该被一次误点扔掉。
	const dirty = note.trim() !== "" || questions.some((question) => isAnswered(drafts[question.id]));

	const update = (id: string, patch: Partial<Draft>) => {
		setConfirming(false);
		setDrafts((previous) => ({ ...previous, [id]: { ...(previous[id] ?? EMPTY_DRAFT), ...patch } }));
	};

	const toggle = (question: AskQuestionView, value: string) => {
		const values = (drafts[question.id] ?? EMPTY_DRAFT).values;
		if (question.type !== "multi") {
			update(question.id, { values: [value] });
			return;
		}
		update(question.id, {
			values: values.includes(value) ? values.filter((item) => item !== value) : [...values, value],
		});
	};

	const submit = () => {
		const answers: Record<string, AskAnswer> = {};
		for (const question of questions) {
			const draftOfQuestion = drafts[question.id] ?? EMPTY_DRAFT;
			const answer: AskAnswer = {};
			if (draftOfQuestion.values.length > 0) answer.values = draftOfQuestion.values;
			if (draftOfQuestion.customText.trim() !== "") answer.customText = draftOfQuestion.customText.trim();
			if (answer.values || answer.customText) answers[question.id] = answer;
		}
		onSubmit(answers, note);
	};

	const dismiss = () => {
		if (dirty && !confirming) {
			setConfirming(true);
			return;
		}
		onCancel();
	};

	// 上一题/下一题走同一个边界函数：首题禁用 Back、末题禁用 Next，圆点仍然可以乱序点。
	const goTo = (target: number) => {
		setConfirming(false);
		setActiveIndex(Math.max(0, Math.min(questions.length - 1, target)));
	};

	return (
		// biome-ignore lint/a11y/useSemanticElements: 卡片只是一组控件的外框，fieldset 会给每个选项带上表单语义
		<div className="asktool-card" role="group" aria-live="polite" aria-label={request.title ?? "A question for you"}>
			<div className="asktool-card-header">
				<div className="asktool-card-header-main">
					<span className="asktool-card-title">{request.title ?? "Question"}</span>
					<span className="asktool-card-progress">
						{index + 1} / {questions.length}
					</span>
				</div>
				<div className="asktool-card-header-actions">
					<IconButton label="Close question" onClick={dismiss}>
						<IconClose size={14} />
					</IconButton>
				</div>
			</div>

			{questions.length > 1 ? (
				<div className="asktool-indicators">
					{questions.map((question, questionIndex) => (
						<button
							key={question.id}
							type="button"
							className={cx(
								"asktool-indicator",
								questionIndex === index && "current",
								isAnswered(drafts[question.id]) && "answered",
							)}
							aria-label={`Question ${questionIndex + 1}`}
							aria-current={questionIndex === index}
							onClick={() => goTo(questionIndex)}
						/>
					))}
				</div>
			) : null}

			<p className="asktool-question">
				<span className="asktool-question-number">{index + 1}.</span>
				<span className="asktool-question-body">{current.prompt}</span>
			</p>

			<div className="asktool-options">
				{current.options.map((option) => {
					const selected = draft.values.includes(option.value);
					return (
						<label key={option.value} className={cx("asktool-option", selected && "selected")}>
							<input
								className="asktool-option-input"
								type={current.type === "multi" ? "checkbox" : "radio"}
								name={`ask-${request.flowId}-${current.id}`}
								value={option.value}
								checked={selected}
								onChange={() => toggle(current, option.value)}
							/>
							<span className="asktool-option-copy">
								<span>
									{option.label}
									{option.recommended ? <span className="asktool-option-tag">recommended</span> : null}
								</span>
								{option.description ? (
									<span className="asktool-option-description">{option.description}</span>
								) : null}
							</span>
						</label>
					);
				})}
			</div>

			{current.freeform ? (
				<textarea
					className="asktool-custom-input"
					rows={2}
					placeholder="Or write your own answer"
					aria-label="Your own answer"
					value={draft.customText}
					onChange={(event) => update(current.id, { customText: event.target.value })}
				/>
			) : null}

			<label className="asktool-note">
				<span>Note for the whole answer (optional)</span>
				<textarea
					className="asktool-custom-input"
					rows={2}
					value={note}
					onChange={(event) => {
						setConfirming(false);
						setNote(event.target.value);
					}}
				/>
			</label>

			{ready ? null : <p className="asktool-hint">Answer the required questions to submit.</p>}

			<div className="asktool-footer">
				<div className="asktool-nav">
					<Button variant="ghost" onClick={() => goTo(index - 1)} disabled={index === 0}>
						Back
					</Button>
					<Button variant="ghost" onClick={() => goTo(index + 1)} disabled={index === questions.length - 1}>
						Next
					</Button>
				</div>
				<Button variant="primary" onClick={submit} disabled={!ready}>
					Submit
				</Button>
			</div>

			{confirming ? (
				<div className="asktool-confirm" role="alert">
					<span>Discard your answers?</span>
					<Button variant="ghost" onClick={() => setConfirming(false)}>
						Keep
					</Button>
					<Button variant="secondary" onClick={onCancel}>
						Discard
					</Button>
				</div>
			) : null}
		</div>
	);
}
