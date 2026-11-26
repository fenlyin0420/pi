// 正文预览弹窗：把当前（可能还没保存的）正文按 markdown 渲染一遍，图片和排版先看清楚再存。

import { Button, Dialog } from "../../ui.tsx";
import { IssueMarkdown } from "./IssueMarkdown.tsx";

type IssuePreviewProps = {
	open: boolean;
	source: string;
	/** 相对图片路径按这个目录解析。 */
	workspace: string | null;
	onOpenExternal: (url: string) => void;
	onClose: () => void;
};

/** 预览整段正文：内容与详情里保存后看到的一致，只是不落盘。 */
export function IssuePreview({ open, source, workspace, onOpenExternal, onClose }: IssuePreviewProps) {
	return (
		<Dialog
			open={open}
			onClose={onClose}
			title="Preview"
			label="Issue description preview"
			className="issue-preview"
			width={720}
			footer={
				<Button variant="secondary" onClick={onClose}>
					Close
				</Button>
			}
		>
			{source.trim() === "" ? (
				<p className="issue-preview-empty">Nothing to preview yet.</p>
			) : (
				<div className="issue-preview-body">
					<IssueMarkdown source={source} workspace={workspace} onOpenExternal={onOpenExternal} />
				</div>
			)}
		</Dialog>
	);
}
