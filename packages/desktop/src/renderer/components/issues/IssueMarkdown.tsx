// issue 正文的 markdown 渲染：图片地址先交给 main 换成 data URL 再显示，渲染进程的 CSP 只放 data:。

import { createContext, useContext, useEffect, useState } from "react";
import type { IssueImage as IssueImageResult } from "../../../shared/contract.ts";
import { Markdown } from "../Markdown.tsx";

/** 相对图片路径按哪个目录解析；由 IssueMarkdown 提供，图片渲染器从上下文里取。 */
const WorkspaceContext = createContext<string | null>(null);

type IssueMarkdownProps = {
	source: string;
	/** 相对图片路径按这个目录解析；null 表示没有 workspace，只有绝对路径和 URL 能读。 */
	workspace: string | null;
	onOpenExternal: (url: string) => void;
};

/** 一段 issue 正文（详情里渲染的、预览弹窗里的）：排版沿用对话区的 .prose-chat。 */
export function IssueMarkdown({ source, workspace, onOpenExternal }: IssueMarkdownProps) {
	return (
		<WorkspaceContext.Provider value={workspace}>
			<div className="issue-markdown prose-chat">
				<Markdown source={source} onOpenExternal={onOpenExternal} img={IssueImage} />
			</div>
		</WorkspaceContext.Provider>
	);
}

/** 一张图在界面上的三态：解析中、拿到 data URL、解析失败带原因。 */
type ImageState = { kind: "loading" } | IssueImageResult;

/** markdown 里的 <img>：地址交给 main 解析，读不出来的原因写在图原来的位置上。 */
function IssueImage({ src, alt }: { src?: string; alt?: string }) {
	const workspace = useContext(WorkspaceContext);
	const address = src ?? "";
	const [state, setState] = useState<ImageState>({ kind: "loading" });

	useEffect(() => {
		let live = true;
		setState({ kind: "loading" });
		void window.piDesktop.resolveIssueImage(workspace, address).then((result) => {
			if (live) setState(result);
		});
		return () => {
			live = false;
		};
	}, [workspace, address]);

	if (state.kind === "loading") return <span className="issue-image-state">Loading image…</span>;
	if (state.kind === "error") {
		return (
			<span className="issue-image-state is-error" title={address}>
				{alt ? `${alt}: ` : ""}
				{state.message}
			</span>
		);
	}
	return <img className="issue-image" src={state.dataUrl} alt={alt ?? ""} />;
}
