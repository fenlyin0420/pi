// 内置图片查看器：用户消息里的图片附件点开后在这里看，点图在“适应窗口”和“原始尺寸”之间切换。

import { useState } from "react";
import type { ImageView } from "../../shared/contract.ts";
import { Button, cx, Dialog, Spinner } from "../ui.tsx";

/**
 * 装着查看器的那张卡片：打开就立刻有反馈，读不出来时说清是什么问题，
 * 而不是点了没反应。
 */
export type ViewerState =
	| { kind: "loading"; name: string }
	| { kind: "ready"; image: ImageView }
	| { kind: "error"; name: string; message: string };

type ImageViewerProps = {
	/** 要看的图；null 表示关着。 */
	state: ViewerState | null;
	onClose: () => void;
};

/** 图片查看器。缩放状态按路径记：换一张图自然回到“适应窗口”，不用额外重置。 */
export function ImageViewer({ state, onClose }: ImageViewerProps) {
	const [actualSizePath, setActualSizePath] = useState<string | null>(null);
	const image = state?.kind === "ready" ? state.image : null;
	const path = image?.path ?? null;
	const actualSize = path !== null && actualSizePath === path;
	const toggleSize = () => setActualSizePath(actualSize ? null : path);

	if (state === null) return null;

	return (
		<Dialog
			open
			onClose={onClose}
			title={state.kind === "ready" ? state.image.name : state.name}
			width={900}
			footer={
				image === null ? null : (
					<>
						{path === null ? null : (
							<>
								<Button variant="ghost" onClick={() => window.piDesktop.send({ type: "revealPath", path })}>
									Show in folder
								</Button>
								<Button variant="ghost" onClick={() => window.piDesktop.send({ type: "openPath", path })}>
									Open with default app
								</Button>
							</>
						)}
						<Button variant="ghost" aria-pressed={actualSize} onClick={toggleSize}>
							{actualSize ? "Fit to window" : "Actual size"}
						</Button>
					</>
				)
			}
		>
			{state.kind === "loading" ? (
				<p className="image-viewer-state">
					<Spinner /> Loading…
				</p>
			) : state.kind === "error" ? (
				<p className="image-viewer-state">{state.message}</p>
			) : (
				<button
					type="button"
					className={cx("image-viewer-stage", actualSize && "is-actual")}
					onClick={toggleSize}
					aria-label={actualSize ? "Fit the image to the window" : "Show the image at its actual size"}
				>
					<img className="image-viewer-image" src={state.image.dataUrl} alt={state.image.name} />
				</button>
			)}
		</Dialog>
	);
}
