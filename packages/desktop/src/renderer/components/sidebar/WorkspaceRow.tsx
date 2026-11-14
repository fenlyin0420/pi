// 侧栏的一个 workspace 行：目录名占满一行，点整行展开或折叠，右键就在这里开新会话。

import { memo } from "react";
import type { WorkspaceSummary } from "../../../shared/contract.ts";
import { IconFolder, IconFolderOpen, IconPlus } from "../../icons.tsx";
import { cx, useContextMenu } from "../../ui.tsx";
import { RunningStatus } from "./RunningStatus.tsx";
import { UnreadDot } from "./UnreadDot.tsx";

type WorkspaceRowProps = {
	workspace: WorkspaceSummary;
	/** 是否是当前 workspace：它决定新建会话落在哪个目录，也是 composer 底部显示的那个。 */
	active: boolean;
	expanded: boolean;
	/** 它有会话在跑，而且它现在是收起的：展开时这个加载圈下放到会话行，不同时出现在两层。 */
	running: boolean;
	/** 它有未读会话，而且它现在是收起的：展开时圆点下放到会话行，不同时出现在两层。 */
	unread: boolean;
	/** expanded 是当前显示出来的状态；侧栏从这个值反推下一个状态，记录和显示才不会打架。 */
	onToggle: (path: string, expanded: boolean) => void;
	/** 右键菜单里的“New session”：在这个目录里开新会话，并把它切成当前 workspace。 */
	onNewSession: (path: string) => void;
};

/**
 * 一行 workspace。整行就是一个按钮，不再有单独的箭头：目录图标本身就是开关，
 * 开着的夹子表示展开、合着的夹子表示折叠，颜色上折叠更黑、展开更灰。
 */
export const WorkspaceRow = memo(function WorkspaceRow({
	workspace,
	active,
	expanded,
	running,
	unread,
	onToggle,
	onNewSession,
}: WorkspaceRowProps) {
	const menu = useContextMenu();

	return (
		<>
			<button
				type="button"
				className={cx("sidebar-workspace-row", active && "is-active")}
				aria-expanded={expanded}
				title={workspace.path}
				onClick={() => onToggle(workspace.path, expanded)}
				onContextMenu={(event) =>
					menu.open(event, [
						{
							id: "new-session",
							label: "New session",
							icon: <IconPlus size={14} aria-hidden="true" />,
							onSelect: () => onNewSession(workspace.path),
						},
					])
				}
			>
				<span className="sidebar-workspace-icon" aria-hidden="true">
					{expanded ? <IconFolderOpen size={14} /> : <IconFolder size={14} />}
				</span>
				<span className="sidebar-workspace-name">{workspace.name}</span>
				{unread ? <UnreadDot /> : null}
				<RunningStatus running={running} />
			</button>
			{menu.node}
		</>
	);
});
