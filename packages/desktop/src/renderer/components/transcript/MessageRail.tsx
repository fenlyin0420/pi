// 右侧的用户消息定位条：每条用户消息一格刻度，点击或拖动直接跳到那条，悬浮显示该条预览。
// 滚到哪一格，那一格自己亮起来 —— 亮块永远落在刻度上，不落在刻度之间。

import {
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { scrollFraction, stepIndex } from "../../lib/scroll-rail.ts";
import { cx } from "../../ui.tsx";

export type MessageMark = { id: string; preview: string };

type MessageRailProps = {
	marks: readonly MessageMark[];
	/** 对话的滚动容器：点亮哪一格按它的滚动几何算。 */
	scroller: RefObject<HTMLDivElement | null>;
	onJump: (id: string, behavior: ScrollBehavior) => void;
};

/**
 * 离散刻度条：刻度均分整条高度，所以“第几条用户消息”与位置是固定的对应关系，
 * 不随内容高度变化而漂移。拖动时连续跳（auto），单击一格是平滑跳。
 * 视口所在的比例落在第几格，那一格就亮：一格一格地换，没有中间态。
 */
export function MessageRail({ marks, scroller, onJump }: MessageRailProps) {
	const railRef = useRef<HTMLElement | null>(null);
	const frame = useRef<number | null>(null);
	// 点亮的那一格。滚动时按帧重算，值不变时 React 自己不重渲染。
	const [active, setActive] = useState(0);
	// 按下点与是否已经越过拖动阈值：没越过的算单击，交给刻度按钮的 onClick。
	const press = useRef<{ pointerId: number; y: number; dragging: boolean } | null>(null);
	// 悬浮预览：top 是刻度中心相对定位条的高度，popover 自己不会跑出定位条。
	const [hover, setHover] = useState<{ index: number; top: number } | null>(null);

	const syncActive = useCallback(() => {
		const node = scroller.current;
		if (!node) return;
		setActive(stepIndex(scrollFraction(node.scrollTop, node.scrollHeight, node.clientHeight), marks.length));
	}, [marks.length, scroller]);

	const scheduleActive = useCallback(() => {
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = null;
			syncActive();
		});
	}, [syncActive]);

	useEffect(() => {
		const node = scroller.current;
		if (!node) return;
		node.addEventListener("scroll", scheduleActive, { passive: true });
		// 内容长高、窗口改宽都会换掉可滚距离：同一格可能因此换成点另一格。
		const observer = new ResizeObserver(() => syncActive());
		observer.observe(node);
		syncActive();
		return () => {
			node.removeEventListener("scroll", scheduleActive);
			observer.disconnect();
			if (frame.current !== null) cancelAnimationFrame(frame.current);
			frame.current = null;
		};
	}, [scroller, scheduleActive, syncActive]);

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
			{marks.map((mark, index) => (
				<button
					key={mark.id}
					type="button"
					className={cx("message-rail-mark", index === active && "is-active")}
					aria-label={`Your message ${index + 1} of ${marks.length}`}
					aria-current={index === active ? "true" : undefined}
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
