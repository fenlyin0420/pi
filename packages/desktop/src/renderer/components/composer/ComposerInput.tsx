// 输入框：自增高 textarea，Enter 发送、Shift+Enter 换行，输入法组字期间的 Enter 不发送。

import type { ClipboardEvent, RefObject } from "react";
import { type KeyboardEvent as ReactKeyboardEvent, useLayoutEffect, useRef, useState } from "react";

/** 展开到第几行后改为内部滚动。 */
const MAX_VISIBLE_ROWS = 8;

/** 面板打开且有可接受项时才有这个对象，上下键与 Enter 因此归面板。 */
export type ComposerPaletteKeys = {
	onMove: (delta: number) => void;
	onAccept: () => void;
	onDismiss: () => void;
};

type ComposerInputProps = {
	inputRef: RefObject<HTMLTextAreaElement | null>;
	value: string;
	placeholder: string;
	/** 没选中 workspace 时关掉输入：聊天必须先有工作目录。 */
	disabled: boolean;
	palette: ComposerPaletteKeys | null;
	onChange: (value: string) => void;
	onSubmit: () => void;
	onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
};

/** 正文输入框；草稿、附件和面板状态都由 Composer 持有。 */
export function ComposerInput({
	inputRef,
	value,
	placeholder,
	disabled,
	palette,
	onChange,
	onSubmit,
	onPaste,
}: ComposerInputProps) {
	const [composing, setComposing] = useState(false);
	// 行高与内边距只量一次：它们是样式常量，每次输入都重算会白读一遍计算样式。
	const metricsRef = useRef<{ lineHeight: number; chrome: number } | null>(null);
	// 已被测量的正文：父组件因为流式输出重渲染时，没有理由再强制一次布局。
	const measuredRef = useRef<string | null>(null);

	useLayoutEffect(() => {
		const element = inputRef.current;
		if (!element) return;
		if (measuredRef.current === value && element.style.height) return;
		measuredRef.current = value;
		if (!metricsRef.current) {
			const style = window.getComputedStyle(element);
			metricsRef.current = {
				lineHeight: Number.parseFloat(style.lineHeight) || 20,
				chrome:
					Number.parseFloat(style.paddingTop) +
					Number.parseFloat(style.paddingBottom) +
					Number.parseFloat(style.borderTopWidth) +
					Number.parseFloat(style.borderBottomWidth),
			};
		}
		const { lineHeight, chrome } = metricsRef.current;
		const maxHeight = Math.ceil(lineHeight * MAX_VISIBLE_ROWS + chrome);
		// 高度由这里收口：先让开样式表里的旧上限，再把 auto 量到的内容高度夹到上限内。
		element.style.maxHeight = "none";
		element.style.height = "auto";
		const content = element.scrollHeight;
		element.style.height = `${Math.min(content, maxHeight)}px`;
		element.style.overflowY = content > maxHeight ? "auto" : "hidden";
	});

	const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		// 输入法确认候选词时也会发 Enter：组字期间的所有按键都属于输入法本身。
		if (composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
		if (palette) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				palette.onMove(event.key === "ArrowDown" ? 1 : -1);
				return;
			}
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				palette.onAccept();
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				palette.onDismiss();
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			onSubmit();
		}
	};

	return (
		<div className="composer-input-stage">
			<textarea
				ref={inputRef}
				className="composer-input"
				rows={1}
				value={value}
				placeholder={placeholder}
				aria-label={placeholder}
				disabled={disabled}
				spellCheck={false}
				autoCorrect="off"
				autoCapitalize="off"
				onChange={(event) => onChange(event.target.value)}
				onPaste={onPaste}
				onKeyDown={handleKeyDown}
				onCompositionStart={() => setComposing(true)}
				onCompositionEnd={() => setComposing(false)}
				onBlur={() => setComposing(false)}
			/>
			{value.length === 0 ? (
				<span className="composer-placeholder" aria-hidden="true">
					{placeholder}
				</span>
			) : null}
		</div>
	);
}
