// renderer 状态：把 main 推来的事件折叠成界面要渲染的一份状态，并向组件暴露命令入口。

import { useCallback, useEffect, useReducer } from "react";
import type {
	AskRequest,
	DesktopCommand,
	DesktopEvent,
	DesktopState,
	IssueDetail,
	MenuAction,
	ModelView,
	TranscriptItem,
} from "../shared/contract.ts";

export type Toast = { id: number; level: "info" | "warning" | "error"; message: string };

/** 一次待写入草稿的队列文本；seq 递增，同一条文字连提两次也要各生效一次。 */
export type DraftRestore = { sessionId: string; text: string; seq: number };

/** 一份待答的 ask_user 提问：属于发起它的会话，与当前正在看哪个会话无关。 */
export type PendingAsk = { sessionId: string; request: AskRequest };

export type AppState = {
	desktop: DesktopState | null;
	models: ModelView[];
	maximized: boolean;
	toasts: Toast[];
	/** 原生菜单动作；seq 递增，便于同一动作连续触发。 */
	menu: { action: MenuAction; seq: number } | null;
	/** 所有在等用户回答的提问，按会话归属；通常是 0 或 1 份。 */
	asks: readonly PendingAsk[];
	/** 撒回的队列消息；Composer 消费一次后自行根据 seq 去重。 */
	draftRestore: DraftRestore | null;
	/** 选中的 issue 正文与评论；null 表示那条 issue 已不存在。 */
	issueDetail: IssueDetail | null;
};

export const INITIAL_STATE: AppState = {
	desktop: null,
	models: [],
	maximized: false,
	toasts: [],
	menu: null,
	asks: [],
	draftRestore: null,
	issueDetail: null,
};

let toastId = 0;
let menuSeq = 0;
let restoreSeq = 0;

/**
 * 事件折叠。结构变化走 transcript 快照，流式增量只改目标 part，未命中的事件一律忽略：
 * 切换会话时旧会话的残留增量不会污染新界面。
 */
export function reduceEvent(state: AppState, event: DesktopEvent): AppState {
	switch (event.type) {
		case "state":
			return { ...state, desktop: event.state };
		case "transcript": {
			if (!state.desktop || state.desktop.activeSessionId !== event.sessionId) return state;
			return { ...state, desktop: { ...state.desktop, transcript: event.items } };
		}
		case "models":
			return { ...state, models: event.models };
		case "window":
			return { ...state, maximized: event.maximized };
		case "menu":
			menuSeq += 1;
			return { ...state, menu: { action: event.action, seq: menuSeq } };
		case "files":
			// @ 引用补全的结果由 MentionPalette 自己订阅消费，主状态不持有它。
			return state;
		case "issueDetail":
			return { ...state, issueDetail: event.detail };
		case "ask": {
			// 同一 flowId 再来一次（比如扩展重发）只换那一份，已答完的不影响别的会话。
			const others = state.asks.filter((entry) => entry.request.flowId !== event.request.flowId);
			return { ...state, asks: [...others, { sessionId: event.sessionId, request: event.request }] };
		}
		case "askClosed":
			return state.asks.some((entry) => entry.request.flowId === event.flowId)
				? { ...state, asks: state.asks.filter((entry) => entry.request.flowId !== event.flowId) }
				: state;
		case "draftRestore":
			restoreSeq += 1;
			return {
				...state,
				draftRestore: { sessionId: event.sessionId, text: event.text, seq: restoreSeq },
			};
		case "toast":
			toastId += 1;
			return {
				...state,
				toasts: [...state.toasts, { id: toastId, level: event.level, message: event.message }].slice(-4),
			};
	}
}

type Action = { type: "event"; event: DesktopEvent } | { type: "dismissToast"; id: number };

function reducer(state: AppState, action: Action): AppState {
	switch (action.type) {
		case "event":
			return reduceEvent(state, action.event);
		case "dismissToast":
			return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };
	}
}

export type DesktopApi = {
	state: AppState;
	send: (command: DesktopCommand) => void;
	dismissToast: (id: number) => void;
};

/** 订阅 main 的事件流。首个 state 事件和 getState 的返回值谁先到都行，后到的覆盖先到的。 */
export function useDesktop(): DesktopApi {
	const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

	useEffect(() => {
		const unsubscribe = window.piDesktop.onEvent((event) => dispatch({ type: "event", event }));
		void window.piDesktop
			.getState()
			.then((desktop) => dispatch({ type: "event", event: { type: "state", state: desktop } }));
		return unsubscribe;
	}, []);

	const send = useCallback((command: DesktopCommand) => {
		void window.piDesktop.send(command);
	}, []);

	const dismissToast = useCallback((id: number) => dispatch({ type: "dismissToast", id }), []);

	return { state, send, dismissToast };
}

/** 把最后一条消息的 token 用量压成一行；会话统计在 agent.usage 里。 */
export function transcriptText(items: readonly TranscriptItem[]): string {
	return items
		.map((item) => {
			if (item.kind === "user") return `User:\n${item.text}`;
			if (item.kind === "notice") return item.text;
			return item.parts
				.map((part) => {
					if (part.type === "tool") return `[${part.call.name}] ${part.call.summary}`;
					if (part.type === "artifact") return `[html] ${part.artifact.title}`;
					return part.text;
				})
				.join("\n");
		})
		.join("\n\n");
}
