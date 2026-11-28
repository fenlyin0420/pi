// 通知的取舍与文案：纯函数，不碰 Electron，好在单测里直接调。
//
// 两件事值得响铃：模型这一轮跑完了（agent_settled，Esc 打断的除外），以及 ask_user 在等人回答。
// 和 pi-notify 的判断一致：人就在这一条消息上看着的时候，界面里的状态行与提问卡片已经说清了，
// 再从桌角弹一次只是噪音。

import type { NoticeKind } from "../shared/contract.ts";

/** 会话里发生的一件值得弹窗的事；取舍所需的全部事实也一起带过来。 */
export type SessionNotice = {
	kind: NoticeKind;
	sessionId: string;
	/** 这条会话是不是用户正看着的那一条。 */
	sessionActive: boolean;
	/** 用户按 Esc 打断的那一轮收尾，不算“跑完”。 */
	aborted: boolean;
	title: string;
	body: string;
};

export type NotifyDecision = {
	kind: NoticeKind;
	/** 设置里的总开关。 */
	enabled: boolean;
	/** 设置里的“只在不在前台时提示”。 */
	awayOnly: boolean;
	aborted: boolean;
	/** 主窗口此刻是不是前台窗口。 */
	windowFocused: boolean;
	sessionActive: boolean;
};

/** 这次事件要不要弹卡片（以及响铃：两者同生同灭，不做“只响不弹”）。 */
export function shouldNotify(input: NotifyDecision): boolean {
	if (!input.enabled) return false;
	// Esc 打断的那一轮是用户自己叫停的，不必再告诉他停下来了。
	if (input.kind === "settled" && input.aborted) return false;
	if (!input.awayOnly) return true;
	// 前台窗口 + 正看着的这条会话：界面上已经有反馈，桌面端不再打扰。
	return !(input.windowFocused && input.sessionActive);
}

/** 正文压成一行短文本：换行与连续空白折成空格，超长按字符（不是字节）截断加省略号。 */
export function noticeBody(text: string, limit = 180): string {
	const oneLine = text.replaceAll(/\s+/gu, " ").trim();
	const characters = [...oneLine];
	if (characters.length <= limit) return oneLine;
	return `${characters.slice(0, limit).join("")}…`;
}

/** 任务栏徽标用哪张图：1–9 用带数字的那张，10 以上用 `more`（画作 9+），0 不画。 */
export function badgeAsset(count: number): string | null {
	if (!Number.isFinite(count) || count <= 0) return null;
	const rounded = Math.floor(count);
	return `badge-${rounded > 9 ? "more" : rounded}`;
}

/**
 * 任务栏徽标背后的那堆会话：弹过通知、用户还没回来看的。
 * 按会话去重（同一个会话跑完两轮只算一条），看过了就从集合里拿掉。
 * 不直接用会话中枢的 unread：那是“后台跑出了新内容”的侧栏圆点，与“我弹过一条通知”不一样——
 * 窗口在后面而你在跟前看的那一轮也算进来。
 */
export class AttentionSet {
	private readonly sessions = new Set<string>();

	/** 某个会话刚弹过一条通知。 */
	mark(sessionId: string): void {
		if (sessionId !== "") this.sessions.add(sessionId);
	}

	/** 用户已经回到这条会话（窗口在前台且看的就是它）：把标记摘掉。 */
	attend(sessionId: string | null): void {
		if (sessionId === null) return;
		this.sessions.delete(sessionId);
	}

	get size(): number {
		return this.sessions.size;
	}
}
