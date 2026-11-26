// `@` 文件引用面板：去抖查询项目文件并列出命中项，选中后把相对路径写回输入框。

import { useEffect, useRef, useState } from "react";
import type { DesktopEvent } from "../../../shared/contract.ts";
import { IconFile } from "../../icons.tsx";
import { cx } from "../../ui.tsx";

/** 面板最多列出多少条：列表一长就成了翻页器，敲几个字比翻页快。 */
const MENTION_LIMIT = 10;

/** 每次输入的停顿；连续的击键只发起最后一次搜索。 */
const SEARCH_DEBOUNCE_MS = 150;

/** 输入末尾正在写的引用查询串；没有正在输入的引用时返回 null。 */
export function mentionQuery(value: string): string | null {
	const match = /(?:^|\s)@([^\s@]*)$/.exec(value);
	return match ? match[1] : null;
}

/** 把末尾的引用查询词换成选中文件的相对路径，并留一个空格继续写正文。 */
export function withMention(value: string, path: string): string {
	const query = mentionQuery(value);
	if (query === null) return value;
	return `${value.slice(0, value.length - query.length - 1)}@${path} `;
}

/**
 * 自己订阅 files 事件再按 requestId 认领结果：面板是这条路唯一的消费者，
 * 不需要为它在全局 store 里留一份状态。query 为 null 表示面板已关闭。
 */
export function useMentionSearch(query: string | null): readonly string[] {
	const [files, setFiles] = useState<readonly string[]>([]);
	const requestId = useRef(0);

	useEffect(() => {
		if (query === null) {
			// 关掉面板时让在途结果失效，下次打开不会先闪一屏旧文件。
			requestId.current += 1;
			setFiles([]);
			return;
		}
		const id = requestId.current + 1;
		requestId.current = id;
		const timer = window.setTimeout(() => {
			void window.piDesktop.send({ type: "searchFiles", requestId: id, query });
		}, SEARCH_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [query]);

	useEffect(() => {
		return window.piDesktop.onEvent((event: DesktopEvent) => {
			// 慢请求可能带着更早的 requestId 回来，只认最近一次发起的那次。
			if (event.type !== "files" || event.requestId !== requestId.current) return;
			setFiles(event.files.slice(0, MENTION_LIMIT));
		});
	}, []);

	return files;
}

type MentionPaletteProps = {
	/** 相对项目根的文件路径。 */
	files: readonly string[];
	highlight: number;
	onHover: (index: number) => void;
	onPick: (path: string) => void;
};

/** 文件列表；还没有命中项时不渲染，输入框照常接受正文。 */
export function MentionPalette({ files, highlight, onHover, onPick }: MentionPaletteProps) {
	if (files.length === 0) return null;
	return (
		<div className="composer-palette" role="listbox" aria-label="Project files">
			<div className="composer-ac-list">
				{files.map((path, index) => (
					<button
						key={path}
						type="button"
						role="option"
						aria-selected={index === highlight}
						title={path}
						className={cx("composer-plus-item", "composer-ac-item", index === highlight && "kb-active")}
						// mousedown 而不是 click：焦点始终留在输入框，插入后能接着写
						onMouseDown={(event) => {
							event.preventDefault();
							onPick(path);
						}}
						onMouseMove={() => onHover(index)}
					>
						<span className="composer-ac-icon">
							<IconFile size={14} aria-hidden="true" />
						</span>
						<span className="composer-ac-name">{path.slice(path.lastIndexOf("/") + 1)}</span>
						<span className="composer-ac-path">{path}</span>
					</button>
				))}
			</div>
			<div className="composer-ac-footer">
				<span>↑↓ choose</span>
				<span>Enter insert</span>
			</div>
		</div>
	);
}
