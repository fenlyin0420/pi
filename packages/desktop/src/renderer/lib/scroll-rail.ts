// 定位条点亮哪一格的换算：滚动位置换成比例，比例换成格序号。

/** 视口在整条内容里的位置比例，0..1；内容不足一屏、没有可滚的地方时是 0。 */
export function scrollFraction(scrollTop: number, scrollHeight: number, clientHeight: number): number {
	const span = scrollHeight - clientHeight;
	if (span <= 0) return 0;
	return Math.min(1, Math.max(0, scrollTop / span));
}

/** 比例落在第几格刻度上，0..count-1；一格都没有时是 -1。 */
export function stepIndex(fraction: number, count: number): number {
	if (count <= 0) return -1;
	return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)));
}
