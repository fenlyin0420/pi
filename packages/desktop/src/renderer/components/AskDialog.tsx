// ask_user 的作答面板：逐题选选项或自填一句，提交回 main 走后扩展的 submit 通道。

import { useMemo, useState } from "react";
import type { AskAnswer, AskQuestionView, AskRequest } from "../../shared/contract.ts";
import { Button, Dialog } from "../ui.tsx";

type Draft = { values: string[]; customText: string };

type AskDialogProps = {
	/** 非空即打开；同一时刻只有一次提问。 */
	request: AskRequest | null;
	onSubmit: (flowId: string, answers: Record<string, AskAnswer>, note?: string) => void;
};

/** 一道题的草稿是否算答过：选了选项或填了自己那一句。 */
function answered(draft: Draft | undefined): boolean {
	if (!draft) return false;
	return draft.values.length > 0 || draft.customText.trim() !== "";
}

/** 渲染一次提问；未给出的题按空草稿处理。 */
export function AskDialog({ request, onSubmit }: AskDialogProps) {
	const [drafts, setDrafts] = useState<Record<string, Draft>>({});
	const [note, setNote] = useState("");

	const questions = request?.questions ?? [];
	const ready = useMemo(
		() => questions.every((question) => !question.required || answered(drafts[question.id])),
		[questions, drafts],
	);

	if (!request) return null;

	const draftOf = (id: string): Draft => drafts[id] ?? { values: [], customText: "" };
	const update = (id: string, patch: Partial<Draft>) => {
		setDrafts((previous) => {
			const current = previous[id] ?? { values: [], customText: "" };
			return { ...previous, [id]: { ...current, ...patch } };
		});
	};

	const toggle = (question: AskQuestionView, value: string) => {
		const current = draftOf(question.id).values;
		if (question.type === "multi") {
			const values = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
			update(question.id, { values });
			return;
		}
		update(question.id, { values: [value] });
	};

	const submit = () => {
		const answers: Record<string, AskAnswer> = {};
		for (const question of questions) {
			const draft = draftOf(question.id);
			const answer: AskAnswer = {};
			if (draft.values.length > 0) answer.values = draft.values;
			if (draft.customText.trim() !== "") answer.customText = draft.customText.trim();
			if (answer.values || answer.customText) answers[question.id] = answer;
		}
		onSubmit(request.flowId, answers, note);
	};

	return (
		<Dialog
			open
			onClose={() => {}}
			title={request.title ?? "A question for you"}
			width={620}
			footer={
				<Button variant="primary" onClick={submit} disabled={!ready}>
					Submit
				</Button>
			}
		>
			<div className="ask-form">
				{questions.map((question) => {
					const draft = draftOf(question.id);
					const inputId = `ask-${question.id}`;
					return (
						<fieldset key={question.id} className="ask-question">
							<legend className="ask-question-prompt">{question.prompt}</legend>
							{question.label !== "" && question.label !== question.prompt ? (
								<p className="ask-question-label">{question.label}</p>
							) : null}
							<div className="ask-options" role={question.type === "multi" ? "group" : undefined}>
								{question.options.map((option) => {
									const checked = draft.values.includes(option.value);
									return (
										<label key={option.value} className={checked ? "ask-option is-checked" : "ask-option"}>
											<input
												type={question.type === "multi" ? "checkbox" : "radio"}
												name={inputId}
												value={option.value}
												checked={checked}
												onChange={() => toggle(question, option.value)}
											/>
											<span className="ask-option-body">
												<span className="ask-option-label">
													{option.label}
													{option.recommended ? <span className="ask-option-tag">recommended</span> : null}
												</span>
												{option.description ? (
													<span className="ask-option-description">{option.description}</span>
												) : null}
											</span>
										</label>
									);
								})}
							</div>
							{question.freeform ? (
								<label className="ask-freeform">
									<span>Or write your own answer</span>
									<textarea
										className="ask-freeform-input"
										value={draft.customText}
										rows={2}
										onChange={(event) => update(question.id, { customText: event.target.value })}
									/>
								</label>
							) : null}
						</fieldset>
					);
				})}
				<label className="ask-freeform">
					<span>Note for the whole answer (optional)</span>
					<textarea
						className="ask-freeform-input"
						value={note}
						rows={2}
						onChange={(event) => setNote(event.target.value)}
					/>
				</label>
			</div>
		</Dialog>
	);
}
