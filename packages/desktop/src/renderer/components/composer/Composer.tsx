// 输入区：草稿、附件、命令与引用面板、工具栏和运行态切换都收在这里。

import { type ClipboardEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AgentView, DesktopBridge, ModelView, PromptAttachment, ThinkingLevel } from "../../../shared/contract.ts";
import { MAX_ATTACHMENTS } from "../../../shared/contract.ts";
import { matchSlashCommands, type SlashAction, type SlashCommand, slashQuery } from "../../lib/slash-commands.ts";
import { cx, Kbd } from "../../ui.tsx";
import { AttachmentTray, type ComposerAttachment, readImageFiles } from "./AttachmentTray.tsx";
import { ComposerInput, type ComposerPaletteKeys } from "./ComposerInput.tsx";
import { ComposerToolbar } from "./ComposerToolbar.tsx";
import { MentionPalette, mentionQuery, useMentionSearch, withMention } from "./MentionPalette.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { SlashPalette } from "./SlashPalette.tsx";
import { ThinkingPicker } from "./ThinkingPicker.tsx";

const PLACEHOLDER = "Ask pi anything…";
const DRAFT_KEY_PREFIX = "pi-desktop:draft:";
/** 没有会话时（空窗口、正在新建）草稿也存在同一套键下。 */
const NO_SESSION = "none";

type ComposerProps = {
	sessionId: string | null;
	agent: AgentView;
	models: readonly ModelView[];
	/** 用户是否要看思考内容；关掉时连等级入口一起收起。 */
	thinking: boolean;
	/** 选文件与把拖入的文件换算成磁盘路径；两个都由主进程那边的桥提供。 */
	attach: Pick<DesktopBridge, "attachFiles" | "pathForFile">;
	onSend: (text: string, attachments: readonly PromptAttachment[]) => void;
	onSteer: (text: string) => void;
	onAbort: () => void;
	onSetModel: (model: string) => void;
	onSetThinkingLevel: (level: ThinkingLevel) => void;
	onRequestModels: () => void;
	onOpenSettings: () => void;
	onNewSession: () => void;
};

/** 草稿按会话分开存放，切回来时正文还在原处。 */
function draftStorageKey(sessionId: string | null): string {
	return `${DRAFT_KEY_PREFIX}${sessionId ?? NO_SESSION}`;
}

function readDraft(storageKey: string): string {
	try {
		return window.localStorage.getItem(storageKey) ?? "";
	} catch {
		return "";
	}
}

function writeDraft(storageKey: string, value: string): void {
	try {
		if (value) window.localStorage.setItem(storageKey, value);
		else window.localStorage.removeItem(storageKey);
	} catch {
		// 存不进去（隐私模式、配额满）只意味着草稿不落盘，输入和发送照常
	}
}

/** 提示输入区。 */
export function Composer({
	sessionId,
	agent,
	models,
	thinking,
	attach,
	onSend,
	onSteer,
	onAbort,
	onSetModel,
	onSetThinkingLevel,
	onRequestModels,
	onOpenSettings,
	onNewSession,
}: ComposerProps) {
	const running = agent.status === "running";
	const storageKey = draftStorageKey(sessionId);

	const [value, setValue] = useState(() => readDraft(storageKey));
	const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
	const [highlight, setHighlight] = useState(0);
	// 按 Esc 关掉的面板不因为同一次输入再弹回来，改动正文才解禁
	const [dismissed, setDismissed] = useState(false);
	const [dropTarget, setDropTarget] = useState(false);
	const [modelAnchor, setModelAnchor] = useState<HTMLElement | null>(null);
	const [thinkingAnchor, setThinkingAnchor] = useState<HTMLElement | null>(null);

	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const shellRef = useRef<HTMLDivElement | null>(null);
	const nextAttachmentId = useRef(0);

	// 切会话就换草稿：旧草稿在每次输入时已经落盘，这里只负责把目标会话的读回来
	useEffect(() => {
		setValue(readDraft(storageKey));
		setAttachments([]);
		setHighlight(0);
		setDismissed(false);
		setModelAnchor(null);
		setThinkingAnchor(null);
	}, [storageKey]);

	const slash = slashQuery(value);
	// 已经是命令时不再认 `@`：`/note @src` 这种正文里的引用等命令面板关了再说
	const mention = slash === null ? mentionQuery(value) : null;
	const mentionFiles = useMentionSearch(mention);
	const slashCommands = useMemo(() => (slash === null ? [] : matchSlashCommands(slash, running)), [slash, running]);

	const slashOpen = !dismissed && slashCommands.length > 0;
	const mentionOpen = !dismissed && mentionFiles.length > 0;
	const itemCount = slashOpen ? slashCommands.length : mentionOpen ? mentionFiles.length : 0;
	const activeIndex = itemCount === 0 ? 0 : Math.min(highlight, itemCount - 1);

	function resetText() {
		setValue("");
		writeDraft(storageKey, "");
		setHighlight(0);
		setDismissed(false);
	}

	function changeValue(next: string) {
		setValue(next);
		writeDraft(storageKey, next);
		setHighlight(0);
		setDismissed(false);
	}

	function insertMention(path: string) {
		changeValue(withMention(value, path));
		inputRef.current?.focus();
	}

	function openModelPicker(anchor: HTMLElement | null) {
		if (!anchor) return;
		// 同一颗按钮再点一次就是收起，和点击外部关闭走同一个状态
		if (modelAnchor === anchor) {
			setModelAnchor(null);
			return;
		}
		// 模型清单按需拉取：只有真要选模型时才问 main，状态快照里不带它
		onRequestModels();
		setModelAnchor(anchor);
	}

	function openThinkingPicker(anchor: HTMLElement | null) {
		if (!anchor) return;
		setThinkingAnchor(thinkingAnchor === anchor ? null : anchor);
	}

	function runAction(action: SlashAction) {
		switch (action) {
			case "newSession":
				onNewSession();
				return;
			case "openModel":
				openModelPicker(shellRef.current);
				return;
			case "openThinking":
				openThinkingPicker(shellRef.current);
				return;
			case "openSettings":
				onOpenSettings();
				return;
			case "abort":
				onAbort();
				return;
			case "clearDraft":
				resetText();
				setAttachments([]);
				return;
		}
	}

	function runCommand(command: SlashCommand) {
		// 命令本身只是一次调用，执行完就把命令行从正文里去掉
		resetText();
		runAction(command.action);
	}

	function submit() {
		const text = value.trim();
		if (running) {
			// 运行中的 Enter 是排队：steer 只带正文，附件留给下一轮提示
			if (!text) return;
			onSteer(text);
			resetText();
			return;
		}
		if (!text && attachments.length === 0) return;
		onSend(
			text,
			attachments.map((item) => item.attachment),
		);
		resetText();
		setAttachments([]);
	}

	function addAttachments(items: readonly PromptAttachment[]) {
		if (items.length === 0) return;
		setAttachments((current) => {
			// 同一个文件拖两次只留一份：有路径的按路径认，粘贴进来的图片没有路径，各算各的
			const known = new Set(current.flatMap((item) => (item.attachment.path ? [item.attachment.path] : [])));
			const added = items.flatMap((attachment) => {
				if (attachment.path && known.has(attachment.path)) return [];
				if (attachment.path) known.add(attachment.path);
				nextAttachmentId.current += 1;
				return [{ id: nextAttachmentId.current, attachment }];
			});
			// 超出的部分丢掉：回形针在上限处已经禁用，这里只兜一次拖入或粘贴带进来的超额
			return [...current, ...added].slice(0, MAX_ATTACHMENTS);
		});
	}

	/** 回形针：原生选择器挑出的文件（读不了的文件由 main 提示）。 */
	function pickAttachments() {
		void attach.attachFiles().then(addAttachments);
	}

	function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
		const files = Array.from(event.clipboardData.files);
		if (!files.some((file) => file.type.startsWith("image/"))) return;
		// 有图片就接管粘贴，否则截图会以空文本的形式落进正文
		event.preventDefault();
		void readImageFiles(files).then(addAttachments);
	}

	function handleDragOver(event: DragEvent<HTMLDivElement>) {
		if (!event.dataTransfer.types.includes("Files")) return;
		// 不拦截 dragover 就拿不到 drop，高亮和落下都靠这里
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		setDropTarget(true);
	}

	function handleDragLeave(event: DragEvent<HTMLDivElement>) {
		// relatedTarget 的类型是 EventTarget，拖拽的来源一定是个节点
		if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
		setDropTarget(false);
	}

	function handleDrop(event: DragEvent<HTMLDivElement>) {
		event.preventDefault();
		setDropTarget(false);
		const files = Array.from(event.dataTransfer.files);
		// 从系统里拖来的一定有磁盘路径，交给 main 统一读；浏览器拖来的图片没有路径，退回读 dataURL
		const paths = files.map((file) => attach.pathForFile(file)).filter((path) => path.length > 0);
		if (paths.length > 0) {
			void attach.attachFiles(paths).then(addAttachments);
			return;
		}
		void readImageFiles(files).then(addAttachments);
	}

	const palette: ComposerPaletteKeys | null =
		itemCount > 0
			? {
					onMove: (delta) => setHighlight((previous) => (previous + delta + itemCount) % itemCount),
					onAccept: () => {
						if (slashOpen) {
							const command = slashCommands[activeIndex];
							if (command) runCommand(command);
							return;
						}
						const path = mentionFiles[activeIndex];
						if (path) insertMention(path);
					},
					onDismiss: () => setDismissed(true),
				}
			: null;

	return (
		<div className="composer-dock composer-dock-docked">
			<div className="composer-stack">
				{/* biome-ignore lint/a11y/noStaticElementInteractions: 拖放落点只有鼠标动作，键盘路径就是输入框本身 */}
				<div
					ref={shellRef}
					className={cx("composer-shell", dropTarget && "is-drop-target")}
					onDragEnter={handleDragOver}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
				>
					{slashOpen ? (
						<SlashPalette
							commands={slashCommands}
							highlight={activeIndex}
							onHover={setHighlight}
							onRun={runCommand}
						/>
					) : null}
					{mentionOpen ? (
						<MentionPalette
							files={mentionFiles}
							highlight={activeIndex}
							onHover={setHighlight}
							onPick={insertMention}
						/>
					) : null}
					<div className="composer-input-wrap">
						<AttachmentTray
							attachments={attachments}
							onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
						/>
						<ComposerInput
							inputRef={inputRef}
							value={value}
							placeholder={PLACEHOLDER}
							palette={palette}
							onChange={changeValue}
							onSubmit={submit}
							onPaste={handlePaste}
						/>
					</div>
					<ComposerToolbar
						agent={agent}
						running={running}
						canSend={value.trim().length > 0 || attachments.length > 0}
						canAttach={attachments.length < MAX_ATTACHMENTS}
						showThinkingLevel={thinking && agent.reasoning}
						modelPickerOpen={modelAnchor !== null}
						thinkingPickerOpen={thinkingAnchor !== null}
						onAttachFiles={pickAttachments}
						onOpenModelPicker={openModelPicker}
						onOpenThinkingPicker={openThinkingPicker}
						onSend={submit}
						onAbort={onAbort}
					/>
				</div>
				<div className="composer-hints">
					<span>
						<Kbd>Enter</Kbd> {running ? "queue" : "send"}
					</span>
					<span>
						<Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> newline
					</span>
				</div>
			</div>
			<ModelPicker
				anchor={modelAnchor}
				models={models}
				currentKey={agent.model}
				onSelect={(model) => {
					onSetModel(model);
					setModelAnchor(null);
				}}
				onClose={() => setModelAnchor(null)}
			/>
			<ThinkingPicker
				anchor={thinkingAnchor}
				level={agent.thinkingLevel}
				onSelect={(level) => {
					onSetThinkingLevel(level);
					setThinkingAnchor(null);
				}}
				onClose={() => setThinkingAnchor(null)}
			/>
		</div>
	);
}
