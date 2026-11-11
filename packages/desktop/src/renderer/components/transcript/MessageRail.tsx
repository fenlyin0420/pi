// 右侧的用户消息定位条：每条用户消息一格刻度，点击或拖动直接跳到那条，悬浮显示该条预览。

import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import { cx } from "../../ui.tsx";

export type MessageMark = { id: string; preview: string };

type MessageRailProps = {
	marks: readonly MessageMark[];
	/** 当前视口顶部所在的用户消息，用来点亮那一格。 */
	activeId: string | null;
	onJump: (id: string, behavior: ScrollBehavior) => void;
};

/**
 * 离散刻度条：刻度均分整条高度，所以“第几条用户消息”与位置是固定的对应关系，
 * 不随内容高度变化而漂移。拖动时连续跳（auto），单击一格是平滑跳。
 */
export function MessageRail({ marks, activeId, onJump }: MessageRailProps) {
	const railRef = useRef<HTMLDivElement | null>(null);
	// 按下点与是否已经越过拖动阈值：没越过的算单击，交给刻度按钮的 onClick。
	const press = useRef<{ pointerId: number; y: number; dragging: boolean } | null>(null);
	// 悬浮预览：top 是刻度中心相对定位条的高度，popover 自己不会跑出定位条。
	const [hover, setHover] = useState<{ index: number; top: number } | null>(null);

	const indexAt = (clientY: number) => {
		const node = railRef.current;
		if (!node || marks.length === 0) return -1;
		const rect = node.getBoundingClientRect();
		const ratio = (clientY - rect.top) / Math.max(1, rect.height);
		return Math.min(marks.length - 1, Math.max(0, Math.floor(ratio * marks.length)));
	};

	const jumpTo = (clientY: number) => {
		const index = indexAt(clientY);
		if (index < 0) return;
		onJump(marks[index].id, "auto");
	};

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		press.current = { pointerId: event.pointerId, y: event.clientY, dragging: false };
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const state = press.current;
		if (!state || state.pointerId !== event.pointerId) return;
		if (!state.dragging) {
			if (Math.abs(event.clientY - state.y) < 4) return;
			state.dragging = true;
		}
		jumpTo(event.clientY);
	};

	const endPress = (event: ReactPointerEvent<HTMLDivElement>) => {
		press.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};

	/** 预览卡以刻度为中心，靠近两端时内推，避免超出定位条。 */
	const showPreview = (index: number, element: HTMLElement) => {
		const rail = railRef.current;
		if (!rail || press.current?.dragging) return;
		const railRect = rail.getBoundingClientRect();
		const markRect = element.getBoundingClientRect();
		const center = markRect.top - railRect.top + markRect.height / 2;
		const margin = Math.min(56, railRect.height / 2);
		setHover({ index, top: Math.min(railRect.height - margin, Math.max(margin, center)) });
	};

	return (
		<nav
			ref={railRef}
			className="message-rail no-drag"
			aria-label="Jump to a message"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={endPress}
			onPointerCancel={endPress}
			onPointerLeave={() => setHover(null)}
		>
			{marks.map((mark, index) => (
				<button
					key={mark.id}
					type="button"
					className={cx("message-rail-mark", mark.id === activeId && "is-active")}
					aria-label={`Your message ${index + 1} of ${marks.length}`}
					aria-current={mark.id === activeId ? "true" : undefined}
					onPointerEnter={(event) => showPreview(index, event.currentTarget)}
					onFocus={(event) => showPreview(index, event.currentTarget)}
					onBlur={() => setHover(null)}
					onClick={() => onJump(mark.id, "smooth")}
				/>
			))}
			{hover ? (
				<div className="message-rail-popover" role="tooltip" style={{ top: hover.top }}>
					<span className="message-rail-popover-role">{`Your message ${hover.index + 1} of ${marks.length}`}</span>
					<span className="message-rail-popover-text">{marks[hover.index].preview}</span>
				</div>
			) : null}
		</nav>
	);
}
