// 侧栏的一个 workspace 行：目录名、展开箭头，收起时还有运行中的加载圈和未读圆点；点名称选中，点箭头只展开。

import { memo } from "react";
import type { WorkspaceSummary } from "../../../shared/contract.ts";
import { IconChevronDown, IconChevronRight, IconFolder } from "../../icons.tsx";
import { cx } from "../../ui.tsx";
import { RunningStatus } from "./RunningStatus.tsx";
import { UnreadDot } from "./UnreadDot.tsx";

type WorkspaceRowProps = {
	workspace: WorkspaceSummary;
	/** 是否是当前 workspace：只有它接受输入。 */
	active: boolean;
	expanded: boolean;
	/** 它有会话在跑，而且它现在是收起的：展开时这个加载圈下放到会话行，不同时出现在两层。 */
	running: boolean;
	/** 它有未读会话，而且它现在是收起的：展开时圆点下放到会话行，不同时出现在两层。 */
	unread: boolean;
	onSelect: (path: string) => void;
	onToggle: (path: string) => void;
};

/** 一行 workspace。名称和箭头是两个按钮，键盘用户也能只展开不切换。 */
export const WorkspaceRow = memo(function WorkspaceRow({
	workspace,
	active,
	expanded,
	running,
	unread,
	onSelect,
	onToggle,
}: WorkspaceRowProps) {
	return (
		<div className={cx("sidebar-workspace-row", active && "is-active")}>
			<button
				type="button"
				className="sidebar-workspace-toggle"
				aria-expanded={expanded}
				aria-label={`${expanded ? "Collapse" : "Expand"} ${workspace.name}`}
				onClick={() => onToggle(workspace.path)}
			>
				{expanded ? (
					<IconChevronDown size={12} aria-hidden="true" />
				) : (
					<IconChevronRight size={12} aria-hidden="true" />
				)}
			</button>
			<button
				type="button"
				className="sidebar-workspace-main"
				title={workspace.path}
				aria-current={active ? "true" : undefined}
				onClick={() => onSelect(workspace.path)}
			>
				<IconFolder size={13} aria-hidden="true" />
				<span className="sidebar-workspace-name">{workspace.name}</span>
			</button>
			{unread ? <UnreadDot /> : null}
			<RunningStatus running={running} />
		</div>
	);
});
