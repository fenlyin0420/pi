// 会话文件层的读写：列目录、改名、删除。这里不启动 agent，只碰 SessionManager 的持久层。

import { unlinkSync } from "node:fs";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { splitAttachedFiles } from "../shared/attached-files.ts";
import type { SessionSummary } from "../shared/contract.ts";

const TITLE_LIMIT = 120;
const PREVIEW_LIMIT = 160;

/** 目录下的全部会话，按最近修改排序；置顶标记来自桌面偏好。 */
export async function listSessionSummaries(cwd: string, pinned: ReadonlySet<string>): Promise<SessionSummary[]> {
	const infos = await SessionManager.list(cwd);
	return infos.map((info) => toSessionSummary(info, pinned.has(info.id))).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 会话在侧栏的展示信息。用户设置的名字优先，否则用首条消息截断。 */
export function toSessionSummary(info: SessionInfo, pinned: boolean): SessionSummary {
	return {
		id: info.id,
		path: info.path,
		title: sessionTitle(info),
		createdAt: info.created.getTime(),
		updatedAt: info.modified.getTime(),
		messageCount: info.messageCount,
		pinned,
		status: "idle",
		model: null,
		preview: previewText(info.allMessagesText),
	};
}

/** 通过追加 session_info 条目改名；文件在磁盘上才需要写，空会话由调用方拦下。 */
export function renameSessionFile(path: string, title: string): void {
	const manager = SessionManager.open(path);
	manager.appendSessionInfo(title);
}

/** 删除会话文件。调用方先确认 id 对应的是本机文件路径。 */
export function deleteSessionFile(path: string): void {
	unlinkSync(path);
}

function sessionTitle(info: SessionInfo): string {
	const name = info.name?.trim();
	if (name) return name;
	// 首条消息里可能带着附件路径清单：标题只留用户写的话
	const firstMessage = splitAttachedFiles(info.firstMessage).text.trim().replace(/\s+/g, " ");
	if (!firstMessage) return "Untitled";
	return truncate(firstMessage, TITLE_LIMIT);
}

/** 取整段对话的末尾一行做预览，跳过空行和纯空白。 */
function previewText(allMessagesText: string): string {
	const lines = splitAttachedFiles(allMessagesText).text.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index]?.trim();
		if (line) return truncate(line.replace(/\s+/g, " "), PREVIEW_LIMIT);
	}
	return "";
}

function truncate(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
