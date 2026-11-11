// 展示层格式化：token、耗时、时间戳、金额。所有函数都是纯函数，方便直接测。

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 12.4k / 987 这样的紧凑 token 数。 */
export function formatTokens(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens <= 0) return "0";
	return COMPACT.format(tokens);
}

/** 会话耗时：秒级以下给一位小数，分钟级只保留整分。 */
export function formatDuration(ms: number | null): string {
	if (ms === null || !Number.isFinite(ms) || ms <= 0) return "";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/** 运行中的秒表：12s / 1m 05s / 1h 02m，秒位补零，读数不跳宽。 */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	if (minutes < 1) return `${total}s`;
	const seconds = String(total % 60).padStart(2, "0");
	if (minutes < 60) return `${minutes}m ${seconds}s`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** 金额：小于一分钱时给四位小数，避免统计行永远显示 $0.00。 */
export function formatCost(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "$0";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	if (cost < 1) return `$${cost.toFixed(3)}`;
	return `$${cost.toFixed(2)}`;
}

/** 侧栏时间：今天给时分，昨天给“Yesterday”，更早给月日。 */
export function formatSessionTime(updatedAt: number, now = Date.now()): string {
	const date = new Date(updatedAt);
	if (Number.isNaN(date.getTime())) return "";
	const today = new Date(now);
	if (date.toDateString() === today.toDateString()) {
		return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	}
	const yesterday = new Date(now - 24 * 60 * 60 * 1000);
	if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** 会话分组：今天 / 昨天 / 过去 7 天 / 更早。 */
export function sessionGroup(updatedAt: number, now = Date.now()): "Today" | "Yesterday" | "Last 7 days" | "Older" {
	const today = new Date(now);
	const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
	if (updatedAt >= startOfToday) return "Today";
	if (updatedAt >= startOfToday - 24 * 60 * 60 * 1000) return "Yesterday";
	if (updatedAt >= startOfToday - 7 * 24 * 60 * 60 * 1000) return "Last 7 days";
	return "Older";
}

/** 工具耗时和模型输出的秒数：只在有意义时才显示。 */
export function formatClock(timestamp: number): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
