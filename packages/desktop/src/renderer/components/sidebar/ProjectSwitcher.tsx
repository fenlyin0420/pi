// 侧栏顶部的项目行：显示当前 cwd 的末段目录名，点开是最近项目、打开目录和设置的浮层。

import { useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "../../../shared/contract.ts";
import { IconChevronDown, IconFolder, IconFolderOpen, IconSettings } from "../../icons.tsx";
import { type MenuItem, MenuList, Popover } from "../../ui.tsx";

/** 最近项目最多列几项：菜单位于侧栏窄栏，再长就要滚动。 */
const RECENT_LIMIT = 8;

type ProjectSwitcherProps = {
	cwd: string;
	recentProjects: readonly ProjectSummary[];
	onOpenProject: () => void;
	onOpenRecentProject: (path: string) => void;
	onOpenSettings: () => void;
};

/** 当前项目的名称按钮，加一个项目切换浮层。 */
export function ProjectSwitcher({
	cwd,
	recentProjects,
	onOpenProject,
	onOpenRecentProject,
	onOpenSettings,
}: ProjectSwitcherProps) {
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const [open, setOpen] = useState(false);
	const close = () => setOpen(false);

	const items = useMemo<MenuItem[]>(() => {
		const current = normalizePath(cwd);
		// 当前目录仍然是最近项目之一，用勾选标出来，而不是从列表里摘掉。
		const recent = [...recentProjects]
			.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
			.slice(0, RECENT_LIMIT)
			.map((project) => ({
				id: `recent:${project.path}`,
				label: project.name || folderName(project.path),
				icon: <IconFolder size={14} aria-hidden="true" />,
				checked: normalizePath(project.path) === current,
				onSelect: () => onOpenRecentProject(project.path),
			}));
		return [
			...recent,
			{
				id: "open-project",
				label: "Open folder…",
				icon: <IconFolderOpen size={14} aria-hidden="true" />,
				separatorBefore: recent.length > 0,
				onSelect: onOpenProject,
			},
			{
				id: "settings",
				label: "Settings",
				icon: <IconSettings size={14} aria-hidden="true" />,
				separatorBefore: true,
				onSelect: onOpenSettings,
			},
		];
	}, [cwd, recentProjects, onOpenProject, onOpenRecentProject, onOpenSettings]);

	const name = folderName(cwd);

	return (
		<div className="sidebar-session-group-header">
			<button
				ref={triggerRef}
				type="button"
				className="sidebar-session-group-title"
				title={cwd}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={`Project ${name}`}
				onClick={() => setOpen((value) => !value)}
			>
				<IconFolder size={13} aria-hidden="true" />
				<span className="sidebar-project-name">{name}</span>
				<IconChevronDown size={12} aria-hidden="true" />
			</button>
			<Popover anchor={triggerRef.current} open={open} onClose={close} width={260}>
				<MenuList items={items} onClose={close} />
			</Popover>
		</div>
	);
}

/** 路径末段目录名；根目录这类没有末段时退回原路径。 */
function folderName(path: string): string {
	const parts = path
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

/** 只用于比较同一目录的不同写法：去掉尾部斜杠。 */
function normalizePath(path: string): string {
	return path.replace(/[\\/]+$/, "");
}
