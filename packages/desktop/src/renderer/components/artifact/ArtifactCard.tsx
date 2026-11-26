// 对话区里的一张产物卡片：标题、限高预览和全屏按钮；预览不可交互，点开全屏才接消息。

import { useState } from "react";
import type { ArtifactView } from "../../../shared/contract.ts";
import { IconMaximize } from "../../icons.tsx";
import { ArtifactFrame } from "./ArtifactFrame.tsx";
import { ArtifactOverlay } from "./ArtifactOverlay.tsx";

type ArtifactCardProps = {
	sessionId: string;
	artifact: ArtifactView;
	theme: "dark" | "light";
	onSubmit: (text: string) => void;
	onOpenExternal: (url: string) => void;
};

/** 不进沉浸模式时，产物就是一轮回答里的一个块，位置就是它出现的位置。 */
export function ArtifactCard({ sessionId, artifact, theme, onSubmit, onOpenExternal }: ArtifactCardProps) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<div className="artifact-card">
				<div className="artifact-card-head">
					<span className="artifact-card-title" title={artifact.title}>
						{artifact.title}
					</span>
					{artifact.source === "fence" ? <span className="artifact-card-badge">from text</span> : null}
					<button
						type="button"
						className="icon-btn artifact-card-expand"
						aria-label={`Open ${artifact.title}`}
						title="Open full screen"
						onClick={() => setOpen(true)}
					>
						<IconMaximize size={13} aria-hidden="true" />
					</button>
				</div>
				<div className="artifact-card-preview">
					<ArtifactFrame
						sessionId={sessionId}
						itemId={artifact.id}
						title={artifact.title}
						theme={theme}
						className="artifact-card-frame"
					/>
					{/* 预览层只负责显示：盖一层按钮，点哪儿都是“打开全屏”，不会把点击当成页面交互。 */}
					<button
						type="button"
						className="artifact-card-shade"
						aria-label={`Open ${artifact.title} full screen`}
						onClick={() => setOpen(true)}
					/>
				</div>
			</div>
			{open ? (
				<ArtifactOverlay
					sessionId={sessionId}
					artifact={artifact}
					theme={theme}
					onSubmit={onSubmit}
					onOpenExternal={onOpenExternal}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	);
}
