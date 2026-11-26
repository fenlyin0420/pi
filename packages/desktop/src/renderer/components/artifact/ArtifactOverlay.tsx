// 产物的全屏预览：卡片和舞台共用，Esc 或右上角关闭。

import { useEffect, useRef } from "react";
import type { ArtifactView } from "../../../shared/contract.ts";
import { IconClose } from "../../icons.tsx";
import { ArtifactFrame } from "./ArtifactFrame.tsx";

type ArtifactOverlayProps = {
	sessionId: string;
	artifact: ArtifactView;
	theme: "dark" | "light";
	onSubmit: (text: string) => void;
	onOpenExternal: (url: string) => void;
	onClose: () => void;
};

/** 盖住整个窗口的一帧产物；帧里没有东西可导航，所以没有浏览器那套地址栏。 */
export function ArtifactOverlay({
	sessionId,
	artifact,
	theme,
	onSubmit,
	onOpenExternal,
	onClose,
}: ArtifactOverlayProps) {
	const closeRef = useRef<HTMLButtonElement | null>(null);

	// 打开就把焦点收进这一层：键盘用户不必先 Tab 穿过被盖住的界面。
	useEffect(() => {
		closeRef.current?.focus();
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div className="artifact-overlay" role="dialog" aria-modal="true" aria-label={artifact.title}>
			<div className="artifact-overlay-bar">
				<span className="artifact-overlay-title">{artifact.title}</span>
				<button
					ref={closeRef}
					type="button"
					className="icon-btn"
					aria-label="Close preview"
					title="Close"
					onClick={onClose}
				>
					<IconClose size={14} aria-hidden="true" />
				</button>
			</div>
			<ArtifactFrame
				sessionId={sessionId}
				itemId={artifact.id}
				title={artifact.title}
				theme={theme}
				onSubmit={onSubmit}
				onOpenExternal={onOpenExternal}
				className="artifact-overlay-frame"
			/>
		</div>
	);
}
