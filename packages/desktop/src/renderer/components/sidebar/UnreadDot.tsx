// 侧栏的未读标记：一个 6px 圆点。会话行把它放进标题左侧的缩进槽，父行（分组行、workspace 行）
// 把它排在行尾；同一个未读只在一层出现，折叠时上提到父行，展开时落在会话行。

/** 未读圆点。位置由使用处的 CSS 决定。 */
export function UnreadDot() {
	return <span className="unread-dot" role="img" aria-label="Unread" title="Unread" />;
}
