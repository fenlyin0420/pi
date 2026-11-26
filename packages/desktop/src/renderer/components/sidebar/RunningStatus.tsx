// 侧栏里的“在跑”标记：一个 12px 的加载圈。槽位宽度固定，不跑的行走同一个槽，切换状态时不会推走旁边的文字。

import { Spinner } from "../../ui.tsx";

/** `running` 时显示加载圈。槽位始终占同样宽度，所以有会话在跑的那一行和别的行文字仍然对齐。 */
export function RunningStatus({ running }: { running: boolean }) {
	if (!running) return <span className="running-status" />;
	return (
		<span className="running-status" role="img" aria-label="Running" title="Running">
			<Spinner size={12} />
		</span>
	);
}
