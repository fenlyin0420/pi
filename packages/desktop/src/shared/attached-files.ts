// 提示里附带文件的文本块：main 拼进提示正文，transcript 与侧栏再从正文里剥出来。
// 模型读的是路径本身，agent 用自己的文件工具去读，附件内容不落进上下文。

const OPEN_TAG = "<attached-files>";
const CLOSE_TAG = "</attached-files>";

/** 把附件路径拼成附在提示正文后面的块；没有附件时返回空串，调用方直接跳过。 */
export function formatAttachedFiles(paths: readonly string[]): string {
	if (paths.length === 0) return "";
	// 一个路径一行：只折掉换行符，路径里本来的空格要留着，否则模型读的是另一个文件
	const lines = paths.map((path) => path.replace(/[\r\n]+/g, " ").trim()).filter((path) => path.length > 0);
	if (lines.length === 0) return "";
	return `${OPEN_TAG}\n${lines.join("\n")}\n${CLOSE_TAG}`;
}

/** 正文与其中的附件路径分开：界面只显示用户写的话，路径单独成附件。 */
export function splitAttachedFiles(text: string): { text: string; files: string[] } {
	const files: string[] = [];
	// 一次把块全部拿掉：用户手打的同名标签也只当附件块看，正文里不留残渣
	const stripped = text.replace(/<attached-files>\n?([\s\S]*?)<\/attached-files>/g, (_block, inner: string) => {
		for (const line of inner.split("\n")) {
			const path = line.trim();
			if (path) files.push(path);
		}
		return "";
	});
	if (files.length === 0) return { text, files };
	return { text: stripped.replace(/\n{3,}/g, "\n\n").trim(), files };
}
