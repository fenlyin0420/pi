// 状态行的读屏文案：同一 step 内保持不变，换一步才换一句，交给滚动区之外的常驻 live region 播报。

import { useRef } from "react";
import type { RunActivity } from "../../../shared/contract.ts";
import { pickPhrase, stepKey } from "./RunStatus.tsx";

/**
 * 当前这一步的播报文案；`null` 表示没有在跑。
 * 换步骤靠文字变化播报，所以调用方要把它交给一个常驻的 live region，而不是随步骤重挂的新节点。
 */
export function useStepPhrase(activity: RunActivity | null): string | null {
	const picked = useRef<{ key: string; phrase: string } | null>(null);
	if (!activity) return null;
	const key = stepKey(activity);
	const current =
		picked.current?.key === key
			? picked.current
			: { key, phrase: pickPhrase(activity, picked.current?.phrase ?? null) };
	// 必须原地写回：同一 step 内每次重渲染（秒表、父级状态）都要拿到同一句话，否则文案会来回跳。
	picked.current = current;
	return current.phrase;
}
