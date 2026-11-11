// 共享 UI 原语：按钮、图标按钮、菜单、弹层、开关、字段。所有浮层都挂到 body 层，避免被布局裁剪。

import {
	type ButtonHTMLAttributes,
	type CSSProperties,
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

export function cx(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

const OVERLAY_ROOT_ID = "pi-desktop-overlays";

function overlayRoot(): HTMLElement {
	const existing = document.getElementById(OVERLAY_ROOT_ID);
	if (existing) return existing;
	const root = document.createElement("div");
	root.id = OVERLAY_ROOT_ID;
	document.body.appendChild(root);
	return root;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: "primary" | "secondary" | "ghost";
};

/** 文本按钮，三种语气：primary 用强调色，secondary 用磁贴底色，ghost 只在悬停时上色。 */
export function Button({ variant = "secondary", className, children, ...rest }: ButtonProps) {
	return (
		<button type="button" className={cx("btn", `btn-${variant}`, className)} {...rest}>
			{children}
		</button>
	);
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	label: string;
	active?: boolean;
	size?: "default" | "small";
};

/** 纯图标按钮；label 同时做 aria-label 和原生 tooltip。 */
export function IconButton({ label, active, size = "default", className, children, ...rest }: IconButtonProps) {
	return (
		<button
			type="button"
			className={cx("icon-btn", size === "default" && "icon-btn-square", active && "is-active", className)}
			aria-label={label}
			title={label}
			{...rest}
		>
			{children}
		</button>
	);
}

export function Badge({
	tone = "neutral",
	children,
}: {
	tone?: "neutral" | "success" | "warning" | "error";
	children: ReactNode;
}) {
	return <span className={cx("badge", `badge-${tone}`)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
	return <kbd className="kbd">{children}</kbd>;
}

export function Spinner({ size = 14 }: { size?: number }) {
	return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

/** 表单字段：标签 + 说明 + 控件，统一竖直间距。 */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div className="field">
			<span className="field-label">{label}</span>
			{children}
			{hint ? <span className="field-hint">{hint}</span> : null}
		</div>
	);
}

export function Switch({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			className={cx("switch", checked && "is-on")}
			onClick={() => onChange(!checked)}
		>
			<span className="switch-knob" />
		</button>
	);
}

export function Segmented<T extends string>({
	value,
	options,
	onChange,
	ariaLabel,
}: {
	value: T;
	options: readonly { value: T; label: string }[];
	onChange: (value: T) => void;
	ariaLabel: string;
}) {
	return (
		<div className="segmented" role="tablist" aria-label={ariaLabel}>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					role="tab"
					aria-selected={option.value === value}
					className={cx("segmented-item", option.value === value && "is-active")}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

export type MenuItem = {
	id: string;
	label: string;
	/** 第二行说明或右侧值。 */
	detail?: string;
	icon?: ReactNode;
	checked?: boolean;
	disabled?: boolean;
	/** 分组分隔线画在这一项上方。 */
	separatorBefore?: boolean;
	onSelect?: () => void;
};

type PopoverProps = {
	anchor: HTMLElement | null;
	open: boolean;
	onClose: () => void;
	align?: "start" | "end";
	width?: number;
	children: ReactNode;
};

/** 锚定浮层：按锚点矩形定位，越界时翻转；Esc、外部点击、滚动都会关闭。 */
export function Popover({ anchor, open, onClose, align = "start", width, children }: PopoverProps) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

	useLayoutEffect(() => {
		if (!open || !anchor || !ref.current) return;
		const rect = anchor.getBoundingClientRect();
		const node = ref.current;
		const popWidth = width ?? node.offsetWidth;
		const popHeight = node.offsetHeight;
		let left = align === "end" ? rect.right - popWidth : rect.left;
		left = Math.min(Math.max(8, left), window.innerWidth - popWidth - 8);
		const below = rect.bottom + 6;
		const top = below + popHeight > window.innerHeight - 8 ? Math.max(8, rect.top - popHeight - 6) : below;
		setStyle({ left, top, width, visibility: "visible" });
	}, [open, anchor, align, width]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			}
		};
		const onPointer = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (ref.current?.contains(target) || anchor?.contains(target)) return;
			onClose();
		};
		document.addEventListener("keydown", onKey, true);
		document.addEventListener("pointerdown", onPointer, true);
		window.addEventListener("blur", onClose);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			document.removeEventListener("pointerdown", onPointer, true);
			window.removeEventListener("blur", onClose);
		};
	}, [open, onClose, anchor]);

	if (!open) return null;
	return createPortal(
		<div ref={ref} className="popover" style={style} role="menu">
			{children}
		</div>,
		overlayRoot(),
	);
}

/** 菜单项列表，配合 Popover 使用。 */
export function MenuList({ items, onClose }: { items: readonly MenuItem[]; onClose: () => void }) {
	return (
		<div className="menu-list">
			{items.map((item) => (
				<div key={item.id}>
					{item.separatorBefore ? <div className="menu-separator" /> : null}
					<button
						type="button"
						role="menuitem"
						className={cx("menu-item", item.checked && "is-checked")}
						disabled={item.disabled}
						onClick={() => {
							item.onSelect?.();
							onClose();
						}}
					>
						<span className="menu-item-icon">{item.icon}</span>
						<span className="menu-item-label">{item.label}</span>
						{item.detail ? <span className="menu-item-detail">{item.detail}</span> : null}
						{item.checked ? <span className="menu-item-check">✓</span> : null}
					</button>
				</div>
			))}
		</div>
	);
}

type ContextMenuState = { x: number; y: number; items: readonly MenuItem[] } | null;

type ContextMenuApi = {
	open: (event: { clientX: number; clientY: number; preventDefault(): void }, items: readonly MenuItem[]) => void;
	close: () => void;
	node: ReactNode;
};

/** 右键菜单：在光标处弹出，选中或点空白处关闭。 */
export function useContextMenu(): ContextMenuApi {
	const [state, setState] = useState<ContextMenuState>(null);
	const close = () => setState(null);

	useEffect(() => {
		if (!state) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setState(null);
		};
		const onPointer = () => setState(null);
		document.addEventListener("keydown", onKey, true);
		document.addEventListener("pointerdown", onPointer, true);
		window.addEventListener("blur", onPointer);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			document.removeEventListener("pointerdown", onPointer, true);
			window.removeEventListener("blur", onPointer);
		};
	}, [state]);

	const node = state
		? createPortal(
				<div
					className="context-menu"
					style={{
						left: Math.min(state.x, window.innerWidth - 240),
						top: Math.min(state.y, window.innerHeight - 40),
					}}
					role="menu"
				>
					<MenuList items={state.items} onClose={close} />
				</div>,
				overlayRoot(),
			)
		: null;

	return {
		open: (event, items) => {
			event.preventDefault();
			setState({ x: event.clientX, y: event.clientY, items });
		},
		close,
		node,
	};
}

/** 模态框：遮罩 + 居中的卡片，Esc 关闭。 */
export function Dialog({
	open,
	onClose,
	title,
	children,
	footer,
	width = 480,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	footer?: ReactNode;
	width?: number;
}) {
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;
	return createPortal(
		<div
			className="overlay"
			role="presentation"
			onPointerDown={(event) => event.target === event.currentTarget && onClose()}
		>
			<div className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
				<h2 className="dialog-title">{title}</h2>
				<div className="dialog-body">{children}</div>
				{footer ? <div className="dialog-footer">{footer}</div> : null}
			</div>
		</div>,
		overlayRoot(),
	);
}

/** 主题上下文：只传当前主题，深色/浅色由根节点 data-theme 决定。 */
export const ThemeContext = createContext<"dark" | "light">("dark");
export const useTheme = () => useContext(ThemeContext);
