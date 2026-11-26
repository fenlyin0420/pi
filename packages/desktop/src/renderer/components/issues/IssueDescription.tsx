// 一条 issue 的正文：默认渲染 markdown，点 Edit 才回到源码编辑；编辑时可以先预览再保存。

import { useState } from "react";
import { Button } from "../../ui.tsx";
import { IssueMarkdown } from "./IssueMarkdown.tsx";
import { IssuePreview } from "./IssuePreview.tsx";
import { useImagePaste } from "./use-image-paste.ts";

type IssueDescriptionProps = {
	body: string;
	/** 相对图片路径按这个目录解析。 */
	workspace: string | null;
	onSave: (body: string) => void;
	onOpenExternal: (url: string) => void;
};

/**
 * 正文的读态与写态。写态草稿留在本地：点 Preview 或 Cancel 不该顺手把半成品存进去，
 * 保存只有 Save 一条路。
 */
export function IssueDescription({ body, workspace, onSave, onOpenExternal }: IssueDescriptionProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const [previewing, setPreviewing] = useState(false);
	const { areaRef, onPaste } = useImagePaste(setDraft);
	const editing = draft !== null;
	const dirty = draft !== null && draft !== body;

	const stopEditing = () => {
		setDraft(null);
		setPreviewing(false);
	};
	const save = () => {
		if (draft !== null && draft !== body) onSave(draft);
		stopEditing();
	};

	return (
		<section className="issue-description" aria-label="Issue description">
			<div className="issue-description-head">
				<span className="issue-description-label">Description</span>
				<div className="issue-description-actions">
					{editing ? (
						<>
							<Button variant="ghost" onClick={() => setPreviewing(true)}>
								Preview
							</Button>
							<Button variant="ghost" onClick={stopEditing}>
								Cancel
							</Button>
							<Button variant="primary" disabled={!dirty} onClick={save}>
								Save
							</Button>
						</>
					) : (
						<Button variant="ghost" onClick={() => setDraft(body)}>
							Edit
						</Button>
					)}
				</div>
			</div>

			{editing ? (
				<textarea
					ref={areaRef}
					className="issue-body-input"
					value={draft}
					aria-label="Issue description (markdown)"
					placeholder="Markdown: headings, lists, code, ![screenshot](docs/shot.png) or an https image link. Paste an image to insert a link to it."
					onChange={(event) => setDraft(event.target.value)}
					onPaste={onPaste}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							save();
						}
					}}
					spellCheck={false}
				/>
			) : body.trim() === "" ? (
				<p className="issue-description-empty">No description yet. Edit to write one, markdown supported.</p>
			) : (
				<IssueMarkdown source={body} workspace={workspace} onOpenExternal={onOpenExternal} />
			)}

			<IssuePreview
				open={previewing}
				source={draft ?? body}
				workspace={workspace}
				onOpenExternal={onOpenExternal}
				onClose={() => setPreviewing(false)}
			/>
		</section>
	);
}
