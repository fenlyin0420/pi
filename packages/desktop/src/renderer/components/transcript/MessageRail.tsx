// 右侧的用户消息定位条：每条用户消息一格刻度，点击或拖动直接跳到那条，悬浮显示该条预览。
// 游标是一条和刻度同样形状的亮线，按滚动位置在首末两格之间实时滑动。

import {
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { cursorCenter, scrollFraction } from "../../lib/scroll-rail.ts";
import { cx } from "../../ui.tsx";

export type MessageMark = { id: string; preview: string };

type MessageRailProps = {
	marks: readonly MessageMark[];
	/** 对话的滚动容器：游标的位置按它的滚动几何算。 */
	scroller: RefObject<HTMLDivElement | null>;
	/** 当前视口顶部所在的用户消息，用来标出那一格（给读屏和键盘用）。 */
	activeId: string | null;
	onJump: (id: string, behavior: ScrollBehavior) => void;
};

/**
 * 离散刻度条：刻度均分整条高度，所以“第几条用户消息”与位置是固定的对应关系，
 * 不随内容高度变化而漂移。拖动时连续跳（auto），单击一格是平滑跳。
 * 游标是一格刻度大小的亮线，按滚动比例在首末两格之间滑，滚动时每帧更新。
 */
export function MessageRail({ marks, scroller, activeId, onJump }: MessageRailProps) {
	const railRef = useRef<HTMLElement | null>(null);
	const trackRef = useRef<HTMLDivElement | null>(null);
	const cursorRef = useRef<HTMLDivElement | null>(null);
	const frame = useRef<number | null>(null);
	// 按下点与是否已经越过拖动阈值：没越过的算单击，交给刻度按钮的 onClick。
	const press = useRef<{ pointerId: number; y: number; dragging: boolean } | null>(null);
	// 悬浮预览：top 是刻度中心相对定位条的高度，popover 自己不会跑出定位条。
	const [hover, setHover] = useState<{ index: number; top: number } | null>(null);

	// 游标跟着滚动走：每帧只写一次 style，不进 React 状态，所以滚多快都跟得上。
	const syncCursor = useCallback(() => {
		const node = scroller.current;
		const rail = railRef.current;
		const first = trackRef.current?.firstElementChild;
		const last = trackRef.current?.lastElementChild;
		const cursor = cursorRef.current;
		if (!node || !rail || !(first instanceof HTMLElement) || !(last instanceof HTMLElement) || !cursor) return;
		// 定位条不滚，游标贴的就是它自己的 padding box：量定位条顶部当坐标原点。
		const origin = rail.getBoundingClientRect().top;
		const fraction = scrollFraction(node.scrollTop, node.scrollHeight, node.clientHeight);
		cursor.style.top = `${cursorCenter(midpoint(first) - origin, midpoint(last) - origin, fraction)}px`;
	}, [scroller]);

	const scheduleCursor = useCallback(() => {
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = null;
			syncCursor();
		});
	}, [syncCursor]);

	useEffect(() => {
		const node = scroller.current;
		if (!node) return;
		node.addEventListener("scroll", scheduleCursor, { passive: true });
		// 容器自己的尺寸变了（窗口改宽、输入区长高）刻度列会重新居中，游标得跟着挪。
		const observer = new ResizeObserver(() => syncCursor());
		observer.observe(node);
		syncCursor();
		return () => {
			node.removeEventListener("scroll", scheduleCursor);
			observer.disconnect();
			if (frame.current !== null) cancelAnimationFrame(frame.current);
			frame.current = null;
		};
	}, [scroller, scheduleCursor, syncCursor]);

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

	const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
		if (event.button !== 0) return;
		// 不在按下时捕获指针：捕获会把随后的 click 改派给导航条，刻度按钮的 onClick 就永远不触发。
		press.current = { pointerId: event.pointerId, y: event.clientY, dragging: false };
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
		const state = press.current;
		if (!state || state.pointerId !== event.pointerId) return;
		if (!state.dragging) {
			if (Math.abs(event.clientY - state.y) < 4) return;
			state.dragging = true;
			// 越过阈值才算拖动，这时才需要把指针锁在条上。
			event.currentTarget.setPointerCapture(event.pointerId);
			setHover(null);
		}
		jumpTo(event.clientY);
	};

	const endPress = (event: ReactPointerEvent<HTMLElement>) => {
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
			<div ref={trackRef} className="message-rail-track">
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
			</div>
			<div ref={cursorRef} className="message-rail-cursor" aria-hidden="true" />
			{hover ? (
				<div className="message-rail-popover" role="tooltip" style={{ top: hover.top }}>
					<span className="message-rail-popover-role">{`Your message ${hover.index + 1} of ${marks.length}`}</span>
					<span className="message-rail-popover-text">{marks[hover.index].preview}</span>
				</div>
			) : null}
		</nav>
	);
}

/** 元素中心在视口里的纵坐标。 */
function midpoint(element: HTMLElement): number {
	const rect = element.getBoundingClientRect();
	return rect.top + rect.height / 2;
}
