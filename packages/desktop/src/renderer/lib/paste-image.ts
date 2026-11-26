// 粘贴图片：剪贴板里的图交给 main 存成磁盘文件，正文里只插一行 markdown 链接。

/** 剪贴板里的第一张图片；其余文件（文本、文件夹）不当图片处理。 */
export function pastedImageFile(files: readonly File[]): File | null {
	return files.find((file) => file.type.startsWith("image/")) ?? null;
}

/** 存一张粘贴的图片，返回该插进正文的那行 markdown；失败返回 null（原因 main 已用 toast 报过）。 */
export async function pastedImageMarkdown(file: File): Promise<string | null> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const saved = await window.piDesktop.savePastedImage(toBase64(bytes));
	return saved.kind === "ready" ? saved.markdown : null;
}

/**
 * 把一行 markdown 插到选区位置，单独占一行；返回新文本和插入后该放光标的地方
 * （链接末尾，方便接着写说明）。
 */
export function insertMarkdown(
	text: string,
	start: number,
	end: number,
	markdown: string,
): { text: string; caret: number } {
	const before = text.slice(0, start);
	const after = text.slice(end);
	const lead = before === "" || before.endsWith("\n") ? "" : "\n";
	const tail = after === "" || after.startsWith("\n") ? "" : "\n";
	return { text: `${before}${lead}${markdown}${tail}${after}`, caret: start + lead.length + markdown.length };
}

/** 浏览器只有 btoa；整个数组一次 spread 在大图上会爆栈，按块拼。 */
function toBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
}
