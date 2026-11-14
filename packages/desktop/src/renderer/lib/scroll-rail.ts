// 定位条游标的换算：滚动容器滚到哪，游标就落在刻度列上的哪个高度。

/** 视口在整条内容里的位置比例，0..1；内容不足一屏、没有可滚的地方时是 0。 */
export function scrollFraction(scrollTop: number, scrollHeight: number, clientHeight: number): number {
	const span = scrollHeight - clientHeight;
	if (span <= 0) return 0;
	return Math.min(1, Math.max(0, scrollTop / span));
}

/**
 * 游标在首末两格之间的位置：`first`/`last` 是首末两格刻度中心相对定位条顶部的高度，
 * 返回同坐标下的游标中心。比例 0 压在首格上，1 压在末格上。
 */
export function cursorCenter(first: number, last: number, fraction: number): number {
	return first + (last - first) * fraction;
}
