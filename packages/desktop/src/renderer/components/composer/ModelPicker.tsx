// 模型选择浮层：搜索框 + 按 provider 分组的模型列表，选中即切换。

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ModelView } from "../../../shared/contract.ts";
import { IconCheck, IconSearch, IconSparkles } from "../../icons.tsx";
import { formatTokens } from "../../lib/format.ts";
import { cx, Popover } from "../../ui.tsx";

/** 一次最多渲染的行数：超过这个数，滚动搜索已经比翻列表快。 */
const RENDER_LIMIT = 120;

/** 一个 provider 下命中的模型；组标题就是 provider 名。 */
type ModelGroup = { provider: string; models: readonly ModelView[] };

type ModelPickerProps = {
	/** 锚点存在即打开，为 null 时不渲染。 */
	anchor: HTMLElement | null;
	models: readonly ModelView[];
	/** 当前模型在列表里的 key，用来打勾。 */
	currentKey: string | null;
	onSelect: (key: string) => void;
	onClose: () => void;
};

/** 搜索命中模型名、模型 id 或 provider 名。 */
function matchesQuery(model: ModelView, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return (
		model.name.toLowerCase().includes(needle) ||
		model.id.toLowerCase().includes(needle) ||
		model.provider.toLowerCase().includes(needle)
	);
}

/**
 * 按 provider 分组并保持模型原本的顺序，组因此不会在重渲染间跳位。
 *
 * 目录里有上千个模型，未搜索时只列可用的（加上当前选中的那个），否则一次挂 1600 行 DOM；
 * 一旦开始搜索就放开整个目录，让用户能找到还没配凭据的模型。
 */
function groupByProvider(models: readonly ModelView[], query: string, currentKey: string | null): ModelGroup[] {
	const searching = query.trim().length > 0;
	const buckets = new Map<string, ModelView[]>();
	let visible = 0;
	for (const model of models) {
		if (!matchesQuery(model, query)) continue;
		if (!searching && !model.available && model.key !== currentKey) continue;
		if (visible >= RENDER_LIMIT) break;
		visible += 1;
		const bucket = buckets.get(model.provider);
		if (bucket) bucket.push(model);
		else buckets.set(model.provider, [model]);
	}
	return [...buckets].map(([provider, rows]) => ({ provider, models: rows }));
}

/** 模型浮层；每次打开都从空搜索词开始，焦点落在搜索框。 */
export function ModelPicker({ anchor, models, currentKey, onSelect, onClose }: ModelPickerProps) {
	const [query, setQuery] = useState("");
	const [highlight, setHighlight] = useState(0);
	const searchRef = useRef<HTMLInputElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	// 只有键盘在移高亮时才把行滚进视口：鼠标悬停也滚一下，就会把指针底下那几行挪走。
	const scrollToActive = useRef(false);

	const groups = useMemo(() => groupByProvider(models, query, currentKey), [models, query, currentKey]);
	// 键盘高亮走的是拍平后的序号，所以索引和分组同时准备好。
	const rows = useMemo(() => groups.flatMap((group) => group.models), [groups]);
	const indexOf = useMemo(() => new Map(rows.map((model, index) => [model.key, index])), [rows]);
	const active = rows.length === 0 ? 0 : Math.min(highlight, rows.length - 1);

	// 每次打开都清掉上一次的搜索词；输入框随浮层一起挂载，这里拿到的是新节点。
	useEffect(() => {
		if (!anchor) return;
		setQuery("");
		setHighlight(0);
		searchRef.current?.focus();
	}, [anchor]);

	useEffect(() => {
		if (!scrollToActive.current) return;
		scrollToActive.current = false;
		listRef.current?.querySelector(`[data-model-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (rows.length === 0) return;
			const delta = event.key === "ArrowDown" ? 1 : -1;
			scrollToActive.current = true;
			setHighlight((previous) => (previous + delta + rows.length) % rows.length);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const model = rows[active];
			if (model?.available) onSelect(model.key);
		}
	};

	if (!anchor) return null;

	return (
		<Popover anchor={anchor} open onClose={onClose} align="start" width={320}>
			<div className="composer-model-picker" role="listbox" aria-label="Model">
				<label className="composer-model-search">
					<IconSearch size={14} aria-hidden="true" />
					<input
						ref={searchRef}
						type="text"
						value={query}
						placeholder="Search models"
						aria-label="Search models"
						spellCheck={false}
						autoCorrect="off"
						onChange={(event) => {
							setQuery(event.target.value);
							setHighlight(0);
						}}
						onKeyDown={handleKeyDown}
					/>
				</label>
				<div className="composer-model-list" ref={listRef}>
					{groups.map((group) => (
						<div key={group.provider} className="composer-model-group">
							<div className="composer-model-group-label">{group.provider}</div>
							{group.models.map((model) => {
								const index = indexOf.get(model.key) ?? 0;
								const current = model.key === currentKey;
								return (
									<button
										key={model.key}
										type="button"
										role="option"
										aria-selected={current}
										data-model-index={index}
										title={`${model.provider}/${model.id}`}
										disabled={!model.available}
										className={cx(
											"composer-plus-item",
											"composer-model-option",
											current && "active",
											index === active && "kb-active",
										)}
										onClick={() => onSelect(model.key)}
										onMouseMove={() => setHighlight(index)}
									>
										<span className="composer-model-option-main">
											<span className="composer-model-label">{model.name}</span>
											<span className="composer-model-option-meta">
												{model.reasoning ? (
													<span
														className="composer-model-option-badge"
														title="Reasoning"
														role="img"
														aria-label="Reasoning"
													>
														<IconSparkles size={12} aria-hidden="true" />
													</span>
												) : null}
												<span className="composer-model-option-ctx">
													{formatTokens(model.contextWindow)}
												</span>
												{model.available ? null : (
													<span className="composer-model-option-unavailable">unavailable</span>
												)}
											</span>
										</span>
										<span className="composer-model-check-slot" aria-hidden="true">
											{current ? <IconCheck size={13} className="composer-model-check" /> : null}
										</span>
									</button>
								);
							})}
						</div>
					))}
					{rows.length === 0 ? <div className="composer-model-empty">No models match</div> : null}
				</div>
			</div>
		</Popover>
	);
}
