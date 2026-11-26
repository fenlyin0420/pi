// 右栏的 diff 面板：一次提问改过的文件清单，加上选中那个文件的逐行 diff。

import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { IconClose, IconFile, IconMaximize, IconMinimize } from "../../icons.tsx";
import { diffLines, numberDiff, splitDiff } from "../../lib/diff.ts";
import { ensureLanguage, highlight, highlightVersion, langForPath, subscribeHighlight } from "../../lib/highlight.ts";
import type { TurnFileChange } from "../../lib/turn-changes.ts";
import { cx } from "../../ui.tsx";
import { type DiffColoring, SplitDiff, UnifiedDiff } from "./DiffLines.tsx";

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const RESIZE_STEP = 16;

type DiffPanelProps = {
	files: readonly TurnFileChange[];
	/** 当前看的是哪个文件；清单里高亮它。 */
	selected: string;
	width: number;
	onSelect: (path: string) => void;
	/** 拖动结束后提交一次宽度，和侧栏一样只在抬起时写设置。 */
	onResize: (width: number) => void;
	onClose: () => void;
};

/** 右栏面板：文件清单 + 选中文件的 diff，左边缘可拖动调宽。 */
export function DiffPanel({ files, selected, width, onSelect, onResize, onClose }: DiffPanelProps) {
	const file = files.find((change) => change.path === selected) ?? files[0] ?? null;
	const lines = useMemo(() => (file ? numberDiff(diffLines(file.before, file.after)) : []), [file]);
	const rows = useMemo(() => splitDiff(lines), [lines]);
	// 着色来源：按文件扩展名挑语言，语法包按需加载。语言到货和换主题都会推进版本号，
	// 订阅它只为在这两个时机重新渲染；highlight() 自带缓存，直接取即可。
	const lang = file === null ? null : langForPath(file.path);
	useSyncExternalStore(subscribeHighlight, highlightVersion);
	useEffect(() => {
		if (lang !== null) ensureLanguage(lang);
	}, [lang]);
	const coloring: DiffColoring =
		file === null || lang === null
			? { before: null, after: null }
			: { before: highlight(file.before, lang), after: highlight(file.after, lang) };
	// 默认左右对比：旧/新各一列，看的是一轮的净变化；窄的时候可以切回单列。
	const [layout, setLayout] = useState<"split" | "unified">("split");
	// 全屏：面板盖住整个主栏内容区，看大 diff 时不用拖窄对话列。
	const [fullscreen, setFullscreen] = useState(false);
	// 拖动中只改本地宽度，指针抬起时提交一次设置；提交后本地值继续撑着，直到设置在同一个
	// 宽度上回推（main 写完设置才把新状态发回来）。中间放开会先跳回旧宽度再跳回新宽度。
	const [heldWidth, setHeldWidth] = useState<number | null>(null);
	const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null);
	const settingsWidth = clampWidth(width);
	const shownWidth = heldWidth ?? settingsWidth;
	// CSS 变量不在 CSSProperties 的类型里：只此一处 cast，让样式表里的宽度规则一起跟随。
	const widthVars = { "--ds-diff-width": `${shownWidth}px` } as CSSProperties;

	// 拖动中间被卸载时别把全局光标留在 col-resize。
	useEffect(() => () => document.documentElement.removeAttribute("data-diff-resizing"), []);

	// 设置回推到位就放开本地值：之后（含重启）都听设置的。
	useEffect(() => {
		if (heldWidth !== null && heldWidth === settingsWidth) setHeldWidth(null);
	}, [heldWidth, settingsWidth]);

	/** 面板在右边，往左拖就是变宽，所以位移取反。 */
	const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startWidth: shownWidth,
			width: shownWidth,
		};
		setHeldWidth(shownWidth);
		document.documentElement.setAttribute("data-diff-resizing", "true");
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		drag.width = clampWidth(drag.startWidth + drag.startX - event.clientX);
		setHeldWidth(drag.width);
	};

	/** 抬起时提交一次设置，本地值留到设置回推；取消或没挪动则直接回到设置里的宽度。 */
	const finishResize = (commit: boolean, element?: HTMLElement, pointerId?: number) => {
		const drag = dragRef.current;
		dragRef.current = null;
		document.documentElement.removeAttribute("data-diff-resizing");
		if (element && pointerId !== undefined && element.hasPointerCapture(pointerId)) {
			element.releasePointerCapture(pointerId);
		}
		if (commit && drag && drag.width !== drag.startWidth) {
			setHeldWidth(drag.width);
			onResize(drag.width);
			return;
		}
		setHeldWidth(null);
	};

	// 键盘同样能调宽：左变宽、右变窄，Home/End 到两端。
	const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
		const next =
			event.key === "ArrowLeft"
				? clampWidth(shownWidth + RESIZE_STEP)
				: event.key === "ArrowRight"
					? clampWidth(shownWidth - RESIZE_STEP)
					: event.key === "Home"
						? MAX_WIDTH
						: event.key === "End"
							? MIN_WIDTH
							: null;
		if (next === null) return;
		event.preventDefault();
		if (next === shownWidth) return;
		setHeldWidth(next);
		onResize(next);
	};

	return (
		<aside className={cx("diff-panel", fullscreen && "is-fullscreen")} style={widthVars} aria-label="Changes">
			<hr
				className={cx("diff-panel-resize", heldWidth !== null && "is-resizing")}
				aria-orientation="vertical"
				aria-label="Resize changes panel"
				aria-valuenow={shownWidth}
				aria-valuemin={MIN_WIDTH}
				aria-valuemax={MAX_WIDTH}
				tabIndex={0}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={(event) => finishResize(true, event.currentTarget, event.pointerId)}
				onPointerCancel={(event) => finishResize(false, event.currentTarget, event.pointerId)}
				onKeyDown={onKeyDown}
			/>
			<div className="diff-panel-header">
				<span className="diff-panel-title">Changes</span>
				{file ? (
					<div className="diff-panel-layout">
						<button
							type="button"
							className={cx("diff-panel-layout-option", layout === "split" && "active")}
							aria-pressed={layout === "split"}
							onClick={() => setLayout("split")}
						>
							Split
						</button>
						<button
							type="button"
							className={cx("diff-panel-layout-option", layout === "unified" && "active")}
							aria-pressed={layout === "unified"}
							onClick={() => setLayout("unified")}
						>
							Unified
						</button>
					</div>
				) : null}
				<button
					type="button"
					className="diff-panel-close"
					aria-label={fullscreen ? "Exit full screen" : "Full screen"}
					title={fullscreen ? "Exit full screen" : "Full screen"}
					onClick={() => setFullscreen((value) => !value)}
				>
					{fullscreen ? <IconMinimize size={14} aria-hidden /> : <IconMaximize size={14} aria-hidden />}
				</button>
				<button type="button" className="diff-panel-close" aria-label="Close changes" onClick={onClose}>
					<IconClose size={14} aria-hidden />
				</button>
			</div>
			<ul className="diff-panel-files">
				{files.map((change) => (
					<li key={change.path}>
						<button
							type="button"
							className={cx("diff-panel-file", change.path === file?.path && "active")}
							title={change.path}
							aria-current={change.path === file?.path ? "true" : undefined}
							onClick={() => onSelect(change.path)}
						>
							<IconFile size={13} aria-hidden />
							<span className="diff-panel-file-path">{change.path}</span>
							<span className="diff-panel-file-counts">
								<span className="turn-changes-added">+{change.added}</span>
								<span className="turn-changes-deleted">-{change.deleted}</span>
							</span>
						</button>
					</li>
				))}
			</ul>
			{file ? (
				<div className="diff-panel-body">
					<div className="diff-panel-body-head">
						<span className="diff-panel-body-path" title={file.path}>
							{file.path}
						</span>
						<span className="turn-changes-row-counts">
							<span className="turn-changes-added">+{file.added}</span>
							<span className="turn-changes-deleted">-{file.deleted}</span>
						</span>
					</div>
					{file.truncated ? (
						<p className="diff-panel-note">This diff is cut at the size limit; only the beginning is shown.</p>
					) : null}
					<div className="diff-panel-lines">
						{layout === "split" ? (
							<SplitDiff rows={rows} coloring={coloring} />
						) : (
							<UnifiedDiff lines={lines} coloring={coloring} />
						)}
					</div>
				</div>
			) : null}
		</aside>
	);
}

/** 宽度夹在可用的最小/最大值之间。 */
function clampWidth(value: number): number {
	if (!Number.isFinite(value)) return MIN_WIDTH;
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}
