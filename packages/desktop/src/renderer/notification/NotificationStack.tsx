// 右下角的通知卡片（`notifyStyle: "card"` 或系统 toast 不可用时才走这条路）：
// 新的一张从下方滑进来，几秒后自己退场；点它回到发出它的那条会话。
//
// 窗口的高度由这里说了算：卡片堆叠测多高就报多高，main 照着贴在屏幕工作区右下角；
// 一张都不剩时报 0，窗口藏起来。提示音不在这里放，在主窗口里放（见 lib/chime.ts）。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NoticeView } from "../../shared/contract.ts";

/** 同时最多留几张：再多就把最旧的挤掉，卡片区不该长到半个屏幕。 */
const VISIBLE_LIMIT = 3;
/** 一张卡片停留多久后开始退场。 */
const CARD_LIFETIME_MS = 6500;
/** 与 notification.css 里退场动画的时长对齐：动画跑完才真正删掉。 */
const EXIT_MS = 180;

type Card = NoticeView & { closing: boolean };

/** 卡片堆叠；窗口里只有它一个，位置交给 main。 */
export function NotificationStack() {
	const [cards, setCards] = useState<Card[]>([]);
	const stackRef = useRef<HTMLDivElement | null>(null);

	const dismiss = useCallback((id: number) => {
		setCards((current) => current.filter((card) => card.id !== id));
	}, []);

	useEffect(
		() =>
			window.piNotice.onNotice((notice) => {
				document.documentElement.dataset.theme = notice.theme;
				setCards((current) => [...current, { ...notice, closing: false }].slice(-VISIBLE_LIMIT));
			}),
		[],
	);

	// 卡片增减会改高度（退场只是透明度与位移，不改布局）：每次变更后量一次报给 main，
	// 窗口就始终贴着右下角。空了报 0，main 把窗口藏起来。
	// 不用 ResizeObserver：在这里它不回回调，实测只有手动量才拿得到真高度。
	useLayoutEffect(() => {
		const element = stackRef.current;
		if (!element) return;
		window.piNotice.measure(cards.length === 0 ? 0 : Math.ceil(element.getBoundingClientRect().height));
	}, [cards]);

	return (
		<div className="notice-stack" ref={stackRef}>
			{cards.map((card) => (
				<NoticeCard key={card.id} card={card} onDismiss={dismiss} />
			))}
		</div>
	);
}

/** 一张卡片：到期或点掉之后先播退场动画，再通知上层删除。 */
function NoticeCard({ card, onDismiss }: { card: Card; onDismiss: (id: number) => void }) {
	const [closing, setClosing] = useState(card.closing);

	useEffect(() => {
		const timer = window.setTimeout(() => setClosing(true), CARD_LIFETIME_MS);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => {
		if (!closing) return;
		const timer = window.setTimeout(() => onDismiss(card.id), EXIT_MS);
		return () => window.clearTimeout(timer);
	}, [closing, onDismiss, card.id]);

	return (
		<button
			type="button"
			className={closing ? "notice-card closing" : "notice-card"}
			data-kind={card.kind}
			onClick={() => window.piNotice.activate(card.id)}
		>
			<span className="notice-badge" aria-hidden="true">
				{card.kind === "ask" ? "?" : "π"}
			</span>
			<span className="notice-copy">
				<span className="notice-meta">
					<span className="notice-kind">{card.kind === "ask" ? "Waiting for you" : "Finished"}</span>
					<span className="notice-title">{card.title}</span>
				</span>
				<span className="notice-body">{card.body}</span>
			</span>
		</button>
	);
}
