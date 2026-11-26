// 一份 HTML 产物的沙箱帧：src 走 pi-artifact 协议，帧里的交互经 postMessage 回到宿主回调。

import { useEffect, useRef, useState } from "react";
import { artifactUrl } from "../../../shared/artifact-url.ts";
import { readArtifactMessage } from "../../lib/artifact.ts";
import { cx } from "../../ui.tsx";

type ArtifactFrameProps = {
	sessionId: string;
	itemId: string;
	/** 帧的无障碍标题：产物的标题，或入口页那句话。 */
	title: string;
	theme: "dark" | "light";
	/** 只有可交互的帧（舞台、全屏）才给回调：不给就不收消息，预览帧不会替用户发提示。 */
	onSubmit?: (text: string) => void;
	onOpenExternal?: (url: string) => void;
	className?: string;
};

/**
 * 沙箱帧：不给 allow-same-origin / allow-popups / allow-modals / allow-top-navigation，
 * 帧里碰不到宿主，脚本只能通过 posstMessage 说话。
 */
export function ArtifactFrame({
	sessionId,
	itemId,
	title,
	theme,
	onSubmit,
	onOpenExternal,
	className,
}: ArtifactFrameProps) {
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const [loaded, setLoaded] = useState(false);
	const interactive = onSubmit !== undefined || onOpenExternal !== undefined;
	// 父组件每次渲染都给新的回调引用；这里转成稳定引用，监听器不必跟着重挂。
	const callbacks = useRef({ onSubmit, onOpenExternal });
	useEffect(() => {
		callbacks.current = { onSubmit, onOpenExternal };
	}, [onSubmit, onOpenExternal]);

	// 只认这一帧自己发来的消息：别的页面（含别的产物帧）说同样的话不算数。
	useEffect(() => {
		if (!loaded || !interactive) return;
		const onMessage = (event: MessageEvent) => {
			if (event.source !== frameRef.current?.contentWindow) return;
			const message = readArtifactMessage(event.data);
			if (message === null) return;
			if (message.type === "submit") callbacks.current.onSubmit?.(message.text);
			else if (message.type === "openExternal") callbacks.current.onOpenExternal?.(message.url);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [loaded, interactive]);

	return (
		<iframe
			ref={frameRef}
			className={cx("artifact-frame", className)}
			title={title}
			sandbox="allow-scripts allow-forms"
			src={artifactUrl(sessionId, itemId, theme)}
			onLoad={() => setLoaded(true)}
		/>
	);
}
