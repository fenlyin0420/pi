// 一轮结束后的已编辑文件卡片：标题报文件数与总增减行，逐行列出文件，点开在右栏看 diff。

import { useState } from "react";
import { IconChevronDown, IconChevronRight, IconFile } from "../../icons.tsx";
import { type TurnFileChange, totalCounts } from "../../lib/turn-changes.ts";

/** 展开前显示几行：卡片属于轮末的一段小结，不该顶掉对话本身。 */
const COLLAPSED_ROWS = 4;

type TurnChangesCardProps = {
	changes: readonly TurnFileChange[];
	/** 点标题或某一行：把这一轮的文件和选中的那个交给右栏。 */
	onOpen: (changes: readonly TurnFileChange[], path: string) => void;
};

/** 一张“Edited N files”卡片，只在一轮跑完之后出现。 */
export function TurnChangesCard({ changes, onOpen }: TurnChangesCardProps) {
	const [expanded, setExpanded] = useState(false);
	const foldable = changes.length > COLLAPSED_ROWS;
	const rows = foldable && !expanded ? changes.slice(0, COLLAPSED_ROWS) : changes;
	const total = totalCounts(changes);
	const firstPath = changes[0]?.path ?? null;
	return (
		<div className="turn-changes">
			<button
				type="button"
				className="turn-changes-header"
				aria-label={firstPath === null ? "Open changes" : `Open diff for ${firstPath}`}
				onClick={() => onOpen(changes, firstPath ?? "")}
			>
				<span className="turn-changes-tile" aria-hidden>
					<IconFile size={16} />
				</span>
				<span className="turn-changes-titles">
					<span className="turn-changes-title">
						{changes.length === 1 ? "Edited 1 file" : `Edited ${changes.length} files`}
					</span>
					<span className="turn-changes-stat">
						<Counts added={total.added} deleted={total.deleted} />
					</span>
				</span>
			</button>
			<ul className="turn-changes-list">
				{rows.map((change) => (
					<li key={change.path}>
						<button
							type="button"
							className="turn-changes-row"
							title={change.path}
							onClick={() => onOpen(changes, change.path)}
						>
							<span className="turn-changes-path">{change.path}</span>
							<span className="turn-changes-row-counts">
								{change.truncated ? (
									<span className="turn-changes-truncated">partial</span>
								) : (
									<Counts added={change.added} deleted={change.deleted} />
								)}
							</span>
						</button>
					</li>
				))}
			</ul>
			{foldable ? (
				<button
					type="button"
					className="turn-changes-fold"
					aria-expanded={expanded}
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? "Collapse" : `Show all ${changes.length} files`}
					{expanded ? <IconChevronRight size={12} aria-hidden /> : <IconChevronDown size={12} aria-hidden />}
				</button>
			) : null}
		</div>
	);
}

/** 一行 `+18 -6`；两面都为 0 时不显示，免得给出一对空数字。 */
function Counts({ added, deleted }: { added: number; deleted: number }) {
	return (
		<>
			<span className="turn-changes-added">+{added}</span>
			<span className="turn-changes-deleted">-{deleted}</span>
		</>
	);
}
