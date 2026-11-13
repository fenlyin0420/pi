// 侧栏的一行会话：两行截断的标题、运行中的加载圈、未读圆点、置顶图标，右键菜单给出改名/置顶/删除。

import { memo } from "react";
import type { SessionSummary } from "../../../shared/contract.ts";
import { IconPencil, IconPin, IconPinOff, IconTrash } from "../../icons.tsx";
import { cx, useContextMenu } from "../../ui.tsx";
import { RunningStatus } from "./RunningStatus.tsx";

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
			<RunningStatus running={running} />
			{!running && session.unread ? <span className="thread-item-unread" role="img" aria-label="Unread" /> : null}
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
				>
					{session.title}
				</span>
			</button>
			{menu.node}
		</li>
	);
});
