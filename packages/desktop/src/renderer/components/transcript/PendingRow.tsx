// 对话尾部的待送达插话：一条虚线气泡，标出“模型还没取走”，可以整批撤回。

import type { PendingLine } from "../../lib/pending.ts";

type PendingRowProps = {
	lines: readonly PendingLine[];
	onWithdraw: () => void;
};

/**
 * 一次插话在对话尾部占一个气泡。它不是一条记录（不进 agent.messages、不进定位条），
 * 模型在下一个 step 边界取走后由 queue_update 让它消失，同时正式气泡接手。
 */
export function PendingRow({ lines, onWithdraw }: PendingRowProps) {
	if (lines.length === 0) return null;
	return (
		<div className="pending-queue">
			{lines.map((line) => (
				<article className="message-row user is-pending" key={line.key} aria-label="Queued message">
					<div className="message-col">
						<div className="pending-meta">
							<span className="pending-meta-label">Queued</span>
							{line.files.length > 0 ? (
								<span className="pending-meta-files">
									{line.files.length === 1 ? "1 file" : `${line.files.length} files`}
								</span>
							) : null}
						</div>
						{line.text ? (
							<div className="message-bubble">
								<div className="message-user-text selectable">{line.text}</div>
							</div>
						) : null}
					</div>
				</article>
			))}
			<div className="pending-actions">
				{/* clearQueue 只能整批清，所以按钮永远是“全部撤回”。 */}
				<button type="button" className="pending-withdraw" onClick={onWithdraw}>
					{lines.length === 1 ? "Withdraw" : `Withdraw all (${lines.length})`}
				</button>
			</div>
		</div>
	);
}
