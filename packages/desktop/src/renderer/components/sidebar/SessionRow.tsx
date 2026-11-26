// 侧栏的一行会话：单行标题（过长时右端渐隐、悬停横移）、行尾的未读圆点与运行中加载圈、置顶图标，
// 右键菜单给出改名/置顶/删除。

import { memo, type PointerEvent as ReactPointerEvent } from "react";
import type { SessionSummary } from "../../../shared/contract.ts";
import { IconPencil, IconPin, IconPinOff, IconTrash } from "../../icons.tsx";
import { cx, useContextMenu } from "../../ui.tsx";
import { RunningStatus } from "./RunningStatus.tsx";
import { UnreadDot } from "./UnreadDot.tsx";

/** 标题横移的速度（px/s）：长短只决定时长，看上去始终是同一个速度。 */
const MARQUEE_SPEED = 45;

/**
 * 悬停时先量出溢出宽度，把距离和对应时长写进 CSS 变量：动画只在量完之后才拿到参数，第一帧就是对的。
 * 按距离换算时长而不是固定时长，长标题和短标题才会以同一个速度走。
 */
function measureMarquee(event: ReactPointerEvent<HTMLSpanElement>): void {
	const element = event.currentTarget;
	const distance = Math.max(0, element.scrollWidth - element.clientWidth);
	element.style.setProperty("--marquee-distance", `${distance}px`);
	element.style.setProperty("--marquee-duration", `${Math.round((distance / MARQUEE_SPEED) * 1000)}ms`);
}

type SessionRowProps = {
	session: SessionSummary;
	active: boolean;
	onOpen: (id: string) => void;
	onRename: (session: SessionSummary) => void;
	onDelete: (session: SessionSummary) => void;
	onPin: (id: string, pinned: boolean) => void;
};

/**
 * 一行会话。memo 只在会话对象或选中态变化时重渲染，拖动侧栏宽度这类纯父组件状态
 * 不会波及整列列表。
 */
export const SessionRow = memo(function SessionRow({
	session,
	active,
	onOpen,
	onRename,
	onDelete,
	onPin,
}: SessionRowProps) {
	const menu = useContextMenu();
	const running = session.status === "running";

	return (
		<li
			className={cx("thread-item", active && "active")}
			onContextMenu={(event) =>
				menu.open(event, [
					{
						id: "rename",
						label: "Rename",
						icon: <IconPencil size={14} aria-hidden="true" />,
						onSelect: () => onRename(session),
					},
					{
						id: "pin",
						label: session.pinned ? "Unpin" : "Pin",
						icon: session.pinned ? (
							<IconPinOff size={14} aria-hidden="true" />
						) : (
							<IconPin size={14} aria-hidden="true" />
						),
						onSelect: () => onPin(session.id, !session.pinned),
					},
					{
						id: "delete",
						label: "Delete",
						icon: <IconTrash size={14} aria-hidden="true" />,
						separatorBefore: true,
						onSelect: () => onDelete(session),
					},
				])
			}
		>
			<button
				type="button"
				className="thread-item-main"
				aria-current={active ? "page" : undefined}
				onClick={() => onOpen(session.id)}
			>
				{session.pinned ? <IconPin size={11} className="thread-item-pin" aria-hidden="true" /> : null}
				<span
					className="thread-item-title"
					title={session.preview ? `${session.title}\n\n${session.preview}` : session.title}
					onPointerEnter={measureMarquee}
				>
					<span className="thread-item-title-text">{session.title}</span>
				</span>
			</button>
			<span className="thread-item-status">
				{!running && session.awaitingAsk ? <span className="awaiting-dot" title="Waiting for your answer" /> : null}
				{!running && !session.awaitingAsk && session.unread ? <UnreadDot /> : null}
				<RunningStatus running={running} />
			</span>
			{menu.node}
		</li>
	);
});
