// 侧栏的一行会话：两行截断的标题、更新时间、运行中脉冲点、置顶图标，右键菜单给出改名/置顶/删除。

import { memo } from "react";
import type { SessionSummary } from "../../../shared/contract.ts";
import { IconPencil, IconPin, IconPinOff, IconTrash } from "../../icons.tsx";
import { formatSessionTime } from "../../lib/format.ts";
import { cx, useContextMenu } from "../../ui.tsx";

type SessionRowProps = {
	session: SessionSummary;
	active: boolean;
	/** 分组用的时间基准，由侧栏统一每 60s 推进一次，行内不挂定时器。 */
	now: number;
	onOpen: (id: string) => void;
	onRename: (session: SessionSummary) => void;
	onDelete: (session: SessionSummary) => void;
	onPin: (id: string, pinned: boolean) => void;
};

/**
 * 一行会话。memo 只在会话对象、选中态或时间基准变化时重渲染，拖动侧栏宽度这类
 * 纯父组件状态不会波及整列列表。
 */
export const SessionRow = memo(function SessionRow({
	session,
	active,
	now,
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
			{running ? (
				<span className="thread-item-status running" role="img" aria-label="Running" title="Running" />
			) : null}
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
			<div className="thread-item-meta">
				<span className="thread-item-last-reply">{formatSessionTime(session.updatedAt, now)}</span>
			</div>
			{menu.node}
		</li>
	);
});
