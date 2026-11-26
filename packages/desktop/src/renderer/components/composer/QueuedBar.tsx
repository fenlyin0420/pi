// 输入框上方的待送达队列：这一轮结束才会发出的消息排在这里，可以整批撤回。

import type { PendingLine } from "../../lib/pending.ts";

type QueuedBarProps = {
	lines: readonly PendingLine[];
	onWithdraw: () => void;
};

/**
 * followUp 走的是“这一轮结束后再发”：它不贴对话尾部（那是已提交的插话），
 * 而是排在输入框正上方，和 Codex 的排队条同一个位置。单行截断，全文走 title。
 */
export function QueuedBar({ lines, onWithdraw }: QueuedBarProps) {
	if (lines.length === 0) return null;
	return (
		<div className="queued-bar">
			<span className="queued-bar-label">Next turn</span>
			<ul className="queued-bar-list">
				{lines.map((line) => (
					<li className="queued-bar-item" key={line.key} title={line.text || undefined}>
						<span className="queued-bar-text">{line.text || `${line.files.length} files`}</span>
						{line.files.length > 0 && line.text ? (
							<span className="queued-bar-files">{line.files.length}</span>
						) : null}
					</li>
				))}
			</ul>
			<button type="button" className="queued-bar-withdraw" onClick={onWithdraw}>
				{lines.length === 1 ? "Withdraw" : `Withdraw all (${lines.length})`}
			</button>
		</div>
	);
}
