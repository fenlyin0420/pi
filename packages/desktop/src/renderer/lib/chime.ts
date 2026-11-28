// 通知提示音：pi-notify 的那个 chime。
//
// 声音在主窗口的渲染进程里放，不在通知窗口里：系统 toast 与自绘卡片只能二选一，
// 而不管哪种形态都要响一声，放主窗口就只有一处、也不用为它多养一个窗口。
// 共享同一个 Audio 元素：连着两轮跑完时后一声从头开始，不会叠成两重音。

import notifySound from "../assets/notify.wav";

let element: HTMLAudioElement | null = null;

/** 放一声。没有输出设备、系统静音、被策略拦下——一律吞掉：提示音是尽力而为的。 */
export function playChime(): void {
	element ??= new Audio(notifySound);
	element.currentTime = 0;
	void element.play().catch(() => {});
}
