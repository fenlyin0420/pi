// 右下角的瞬时提示堆叠：每条 6 秒后自行淡出，也可以手动关掉。

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "../icons.tsx";
import type { Toast } from "../store.ts";
import { cx, IconButton } from "../ui.tsx";

const TOAST_DURATION_MS = 6000;
// 与 overlays.css 里 toast-out 的时长对齐：淡出结束才真正删除，否则条目会在动画中途被摘掉。
const TOAST_EXIT_MS = 160;

/** 渲染提示堆叠；挂到 body 上，应用外壳的层叠上下文和对话框遮罩都盖不住它。 */
export function ToastHost({ toasts, onDismiss }: { toasts: readonly Toast[]; onDismiss: (id: number) => void }) {
	return createPortal(
		<div className="toast-host">
			<div className="toast-viewport" aria-live="polite" aria-relevant="additions">
				{toasts.map((toast) => (
					<ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
				))}
			</div>
		</div>,
		document.body,
	);
}

/** 单条提示：到期或点关闭后播放退场动画，再通知上层删除。 */
function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
	const [closing, setClosing] = useState(false);

	useEffect(() => {
		const timer = window.setTimeout(() => setClosing(true), TOAST_DURATION_MS);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => {
		if (!closing) return;
		const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_EXIT_MS);
		return () => window.clearTimeout(timer);
	}, [closing, onDismiss, toast.id]);

	return (
		<div className={cx("toast", toast.level, closing && "closing")}>
			{/* 级别只染这一颗点（overlays.css 的 .toast.<level> .toast-icon），表面保持中性。 */}
			<span className="toast-icon" aria-hidden="true">
				<span className="toast-dot" />
			</span>
			<span className="toast-message">{toast.message}</span>
			<IconButton label="Dismiss" className="toast-dismiss" onClick={() => setClosing(true)}>
				<IconClose size={13} />
			</IconButton>
		</div>
	);
}
