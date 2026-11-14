// issues 的独立动作区：左列表（勾选即入队）、右详情，加上队列总控与新建表单。

import { useEffect, useRef, useState } from "react";
import type { IssueDetail as Detail, IssueRunView, IssueSummary, Platform } from "../../../shared/contract.ts";
import { IconClose, IconPlus } from "../../icons.tsx";
import { filterIssues, type IssueFilter, issuesOf, withSummary } from "../../lib/issues.ts";
import { Button, Field, IconButton } from "../../ui.tsx";
import { IssueDetail } from "./IssueDetail.tsx";
import { IssueList } from "./IssueList.tsx";
import { IssuePreview } from "./IssuePreview.tsx";
import { useImagePaste } from "./use-image-paste.ts";

/** 主区域里的 issue 面板；对话区被它顶掉，侧栏和标题栏保持不动。 */
export function IssuesPage({
	issues,
	run,
	workspace,
	platform,
	detail,
	onClose,
	onSelect,
	onCreate,
	onUpdate,
	onComment,
	onDelete,
	onStatus,
	onSetQueue,
	onOpenThread,
	onRun,
	onOpenExternal,
}: {
	issues: readonly IssueSummary[];
	run: IssueRunView;
	workspace: string | null;
	platform: Platform;
	detail: Detail | null;
	onClose: () => void;
	onSelect: (id: string) => void;
	onCreate: (title: string, body: string) => void;
	onUpdate: (id: string, patch: { title?: string; body?: string }) => void;
	onComment: (id: string, text: string) => void;
	onDelete: (id: string) => void;
	onStatus: (action: "close" | "reopen", id: string) => void;
	onSetQueue: (ids: readonly string[], queued: boolean) => void;
	onOpenThread: (id: string) => void;
	onRun: (action: "start" | "pause" | "stop") => void;
	onOpenExternal: (url: string) => void;
}) {
	const [filter, setFilter] = useState<IssueFilter>("active");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	const scoped = issuesOf(issues, workspace, platform);
	const visible = filterIssues(scoped, filter);
	// 正文与评论来自 issueDetail，状态一律以快照为准：排队、开跑、关闭都只改摘要。
	const shown =
		detail && (selectedId === null || detail.id === selectedId)
			? withSummary(
					detail,
					scoped.find((issue) => issue.id === detail.id),
				)
			: null;

	// 选中项丢了（被删或换了 workspace）就退回“没选”，下面的自动选第一条会接上。
	useEffect(() => {
		if (selectedId !== null && !scoped.some((issue) => issue.id === selectedId)) setSelectedId(null);
	}, [scoped, selectedId]);

	// 没选就选最新一条：新建完成后它正好排在第一位，用户不用再点一次。
	useEffect(() => {
		if (selectedId !== null || creating) return;
		const first = visible[0];
		if (!first) return;
		setSelectedId(first.id);
		onSelect(first.id);
	}, [selectedId, creating, visible, onSelect]);

	const running = run.running.length;
	const pending = run.pending;

	return (
		<section className="issues-page" aria-label="Issues">
			<header className="issues-header">
				<div className="issues-heading">
					<h2 className="issues-title">Issues</h2>
					<p className="issues-subtitle">
						{workspace === null ? "Select a workspace first." : describeRun(running, pending, run.paused)}
					</p>
				</div>
				<div className="issues-run-actions">
					<Button
						variant="secondary"
						onClick={() => onRun("start")}
						disabled={workspace === null || running > 0 || pending === 0}
					>
						Run queue
					</Button>
					<Button variant="ghost" onClick={() => onRun("pause")} disabled={running === 0}>
						Pause
					</Button>
					<Button variant="ghost" onClick={() => onRun("stop")} disabled={running === 0}>
						Stop
					</Button>
					<Button variant="primary" onClick={() => setCreating(true)} disabled={workspace === null}>
						<IconPlus size={14} aria-hidden="true" />
						New issue
					</Button>
					<IconButton label="Close issues" onClick={onClose}>
						<IconClose size={16} />
					</IconButton>
				</div>
			</header>

			<div className="issues-body">
				<IssueList
					issues={scoped}
					filter={filter}
					selectedId={selectedId}
					onFilter={setFilter}
					onSelect={(id) => {
						setCreating(false);
						setSelectedId(id);
						onSelect(id);
					}}
					onSetQueue={onSetQueue}
					onOpenThread={onOpenThread}
					onDelete={(id) => {
						setSelectedId(null);
						onDelete(id);
					}}
				/>
				<div className="issues-detail-pane">
					{creating ? (
						<NewIssueForm
							workspace={workspace}
							onCancel={() => setCreating(false)}
							onOpenExternal={onOpenExternal}
							onCreate={(title, body) => {
								setCreating(false);
								setSelectedId(null);
								setFilter("active");
								onCreate(title, body);
							}}
						/>
					) : shown ? (
						<IssueDetail
							key={shown.id}
							detail={shown}
							run={run}
							workspace={workspace}
							onUpdate={onUpdate}
							onComment={onComment}
							onStatus={onStatus}
							onOpenThread={onOpenThread}
							onOpenExternal={onOpenExternal}
							onDelete={(id) => {
								setSelectedId(null);
								onDelete(id);
							}}
						/>
					) : (
						<p className="issue-empty">
							{scoped.length === 0 ? "No issues yet. Create one to hand work to the agent." : "Select an issue."}
						</p>
					)}
				</div>
			</div>
		</section>
	);
}

/** 队列状态那一行：在跑几条、还有几条、是不是停了。 */
function describeRun(running: number, pending: number, paused: boolean): string {
	if (running > 0) return `Running ${running} of ${running + pending}`;
	if (pending === 0) return "Nothing queued.";
	return paused ? `${pending} queued · paused` : `${pending} queued`;
}

/** 新建表单：标题必填，正文可空（markdown，可预览）；提交后交给 main，选中由列表的自动选中接上。 */
function NewIssueForm({
	workspace,
	onCreate,
	onCancel,
	onOpenExternal,
}: {
	workspace: string | null;
	onCreate: (title: string, body: string) => void;
	onCancel: () => void;
	onOpenExternal: (url: string) => void;
}) {
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [previewing, setPreviewing] = useState(false);
	const titleRef = useRef<HTMLInputElement | null>(null);
	const { areaRef: bodyRef, onPaste: onBodyPaste } = useImagePaste(setBody);

	// 表单是键盘驱动的入口：打开就把焦点交给标题，不用先 Tab 过整个面板。
	useEffect(() => titleRef.current?.focus(), []);

	const submit = () => {
		const trimmed = title.trim();
		if (!trimmed) return;
		onCreate(trimmed, body);
	};

	return (
		<div className="issues-new">
			<Field label="Title">
				<input
					ref={titleRef}
					className="field-input"
					value={title}
					placeholder="What needs to change?"
					onChange={(event) => setTitle(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							submit();
						}
					}}
				/>
			</Field>
			<Field
				label="Description"
				hint="Markdown, rendered once created: headings, lists, code, ![screenshot](docs/shot.png) or an https image link. Paste an image to insert a link to it."
			>
				<textarea
					ref={bodyRef}
					className="field-input issues-new-body"
					value={body}
					onChange={(event) => setBody(event.target.value)}
					onPaste={onBodyPaste}
					spellCheck={false}
				/>
			</Field>
			<div className="issues-new-actions">
				<Button variant="ghost" onClick={() => setPreviewing(true)}>
					Preview
				</Button>
				<span className="issues-new-gap" />
				<Button variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
				<Button variant="primary" onClick={submit} disabled={title.trim().length === 0}>
					Create issue
				</Button>
			</div>
			<IssuePreview
				open={previewing}
				source={body}
				workspace={workspace}
				onOpenExternal={onOpenExternal}
				onClose={() => setPreviewing(false)}
			/>
		</div>
	);
}
