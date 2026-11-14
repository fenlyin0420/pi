// 一条 issue 的详情：标题、正文、评论流和状态动作。动作只在这里出现，对话区不放。

import { useState } from "react";
import type { IssueDetail as Detail, IssueRunView } from "../../../shared/contract.ts";
import { statusLabel, statusTone } from "../../lib/issues.ts";
import { Badge, Button } from "../../ui.tsx";
import { IssueActions } from "./IssueActions.tsx";

/** 详情面板；父组件按 issue id 换 key，切一条就重置编辑状态。 */
export function IssueDetail({
	detail,
	run,
	onUpdate,
	onComment,
	onStatus,
	onOpenThread,
	onDelete,
}: {
	detail: Detail;
	run: IssueRunView;
	onUpdate: (id: string, patch: { title?: string; body?: string }) => void;
	onComment: (id: string, text: string) => void;
	onStatus: (action: "close" | "reopen", id: string) => void;
	onOpenThread: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const [title, setTitle] = useState(detail.title);
	const [body, setBody] = useState(detail.body);
	const [comment, setComment] = useState("");
	const running = detail.status === "running" || run.running.includes(detail.id);
	const dirty = title.trim() !== detail.title || body !== detail.body;

	const save = () => {
		const patch: { title?: string; body?: string } = {};
		if (title.trim() && title.trim() !== detail.title) patch.title = title.trim();
		if (body !== detail.body) patch.body = body;
		if (patch.title === undefined && patch.body === undefined) return;
		onUpdate(detail.id, patch);
	};

	const submitComment = () => {
		const text = comment.trim();
		if (!text) return;
		onComment(detail.id, text);
		setComment("");
	};

	return (
		<div className="issue-detail">
			<header className="issue-detail-head">
				<div className="issue-detail-title-row">
					<span className="issue-number">#{detail.number}</span>
					<input
						className="issue-title-input"
						value={title}
						aria-label="Issue title"
						onChange={(event) => setTitle(event.target.value)}
						onBlur={save}
						onKeyDown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
						}}
					/>
					<Badge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</Badge>
				</div>
				<div className="issue-actions">
					<IssueActions detail={detail} onStatus={onStatus} onOpenThread={onOpenThread} onDelete={onDelete} />
				</div>
			</header>

			{running ? <p className="issue-note">The agent is working on this issue in its own thread.</p> : null}
			{detail.blocked ? <p className="issue-note issue-note-warning">Needs input: {detail.blocked}</p> : null}
			{detail.error ? <p className="issue-note issue-note-error">{detail.error}</p> : null}

			<div className="issue-body">
				<textarea
					className="issue-body-input"
					value={body}
					aria-label="Issue description"
					placeholder="What needs to change?"
					onChange={(event) => setBody(event.target.value)}
					onBlur={save}
					spellCheck={false}
				/>
				{dirty ? (
					<div className="issue-body-save">
						<Button variant="primary" onClick={save}>
							Save
						</Button>
					</div>
				) : null}
			</div>

			<section className="issue-comments" aria-label="Issue comments">
				{detail.comments.length === 0 ? (
					<p className="issue-empty">No comments yet.</p>
				) : (
					<ul className="issue-comment-list">
						{detail.comments.map((entry) => (
							<li key={`${entry.at}-${entry.author}`} className={`issue-comment is-${entry.author}`}>
								<span className="issue-comment-meta">
									{entry.author === "agent" ? "Agent" : "You"} · {new Date(entry.at).toLocaleString()}
								</span>
								<p className="issue-comment-text">{entry.text}</p>
							</li>
						))}
					</ul>
				)}
				<div className="issue-comment-compose">
					<textarea
						className="issue-comment-input"
						value={comment}
						aria-label="Add a comment"
						placeholder="Add a comment for the agent…"
						onChange={(event) => setComment(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								submitComment();
							}
						}}
					/>
					<Button variant="secondary" disabled={comment.trim().length === 0} onClick={submitComment}>
						Comment
					</Button>
				</div>
			</section>
		</div>
	);
}
