// 受控 textarea 的粘贴图片：先把剪贴板里的图交给 main 存盘，再把 markdown 链接插到选区。

import { type ClipboardEvent, type RefObject, useEffect, useRef, useState } from "react";
import { insertMarkdown, pastedImageFile, pastedImageMarkdown } from "../../lib/paste-image.ts";

type ImagePaste = {
	areaRef: RefObject<HTMLTextAreaElement | null>;
	onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
};

/** 给正文输入框的粘贴：返回 textarea 的 ref 与 onPaste，插完之后光标落在链接后面。 */
export function useImagePaste(onInsert: (text: string) => void): ImagePaste {
	const areaRef = useRef<HTMLTextAreaElement | null>(null);
	const [caret, setCaret] = useState<number | null>(null);

	// 新值写进 DOM 之后再设选区：早一步设，光标会落在旧文本的位置上。
	useEffect(() => {
		if (caret === null) return;
		areaRef.current?.focus();
		areaRef.current?.setSelectionRange(caret, caret);
		setCaret(null);
	}, [caret]);

	const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const file = pastedImageFile(Array.from(event.clipboardData.files));
		if (file === null) return;
		// 有图就不让浏览器再把它当文本粘一遍。
		event.preventDefault();
		const { value, selectionStart, selectionEnd } = event.currentTarget;
		void pastedImageMarkdown(file).then((markdown) => {
			if (markdown === null) return;
			const next = insertMarkdown(value, selectionStart, selectionEnd, markdown);
			onInsert(next.text);
			setCaret(next.caret);
		});
	};

	return { areaRef, onPaste };
}
