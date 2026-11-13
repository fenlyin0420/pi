// 排队消息的投影：把队列里的原始文本压成界面能直接渲染的一行（正文 + 附件路径）。

import { splitAttachedFiles } from "../../shared/attached-files.ts";

export type PendingLine = {
	/** 稳定 key：同一段文字可能被提交两次，key 取它在队列里的位置。 */
	key: string;
	text: string;
	/** 这一条带上的附件路径；正文里的附件块已经剥掉。 */
	files: readonly string[];
};

/**
 * 队列文本到界面行的映射。steer 有时会带上 `<attached-files>` 块（运行中提交带附件的那条路径），
 * 原样渲染会把路径块露在气泡里，所以这里统一剥一次。
 */
export function pendingLines(texts: readonly string[]): PendingLine[] {
	return texts.map((raw, index) => ({ key: `pending-${index}`, ...splitAttachedFiles(raw) }));
}
