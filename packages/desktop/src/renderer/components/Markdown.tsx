// Markdown 渲染：GFM 解析，跳过内联 HTML，代码块自带语言标签、复制按钮和异步高亮。

import {
	type ComponentProps,
	isValidElement,
	memo,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { IconCheck, IconCopy } from "../icons.tsx";
import {
	ensureLanguage,
	type HighlightedCode,
	highlight,
	highlightVersion,
	resolveLanguage,
	subscribeHighlight,
	tokenStyle,
} from "../lib/highlight.ts";
import { cx } from "../ui.tsx";

// 插件与选项都是模块级常量：每块 markdown 复用同一份，避免每次渲染重建解析器配置。
const REMARK_PLUGINS = [remarkGfm];

// 跨块生效的语法：引用式链接定义和脚注定义必须留在同一份源码里解析。
const CROSS_BLOCK_SYNTAX = /^ {0,3}\[[^\]]+\]:|\[\^/m;

// CommonMark 的围栏：最多三个空格缩进，三个以上反引号或波浪号。
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

type MarkdownProps = {
	source: string;
	onOpenExternal: (url: string) => void;
};

/** 渲染一段 markdown；顶层按空行切块，流式追加时只有最后一块重新解析。 */
export const Markdown = memo(function Markdown({ source, onOpenExternal }: MarkdownProps) {
	const blocks = useMemo(() => splitBlocks(source), [source]);
	const components = useMemo(() => buildComponents(onOpenExternal), [onOpenExternal]);
	return (
		<>
			{blocks.map((block) => (
				<MarkdownBlock key={block.offset} source={block.source} components={components} />
			))}
		</>
	);
});

const MarkdownBlock = memo(function MarkdownBlock({ source, components }: { source: string; components: Components }) {
	return (
		<ReactMarkdown remarkPlugins={REMARK_PLUGINS} skipHtml components={components}>
			{source}
		</ReactMarkdown>
	);
});

/** 组件映射只依赖 onOpenExternal，链接处理才能跟着同一个回调走。 */
function buildComponents(onOpenExternal: (url: string) => void): Components {
	return {
		pre: PreBlock,
		table: Table,
		a: ({ node: _node, href, children, ...rest }: ComponentProps<"a"> & { node?: unknown }) => (
			<a
				{...rest}
				href={href}
				target="_blank"
				rel="noreferrer"
				onClick={(event) => {
					// 窗口内导航会顶掉整个界面，外链一律交给系统浏览器。
					if (!href) return;
					event.preventDefault();
					onOpenExternal(href);
				}}
			>
				{children}
			</a>
		),
	};
}

const PreBlock = memo(function PreBlock({
	node: _node,
	children,
	...rest
}: ComponentProps<"pre"> & { node?: unknown }) {
	const fenced = fencedCode(children);
	if (!fenced) return <pre {...rest}>{children}</pre>;
	return <CodeBlock code={fenced.code} lang={fenced.lang} />;
});

/** 从 <pre> 里认出 <code class="language-x">；不是围栏代码就返回 null。 */
function fencedCode(children: ReactNode): { code: string; lang: string } | null {
	const element = Array.isArray(children) ? children.find((child) => isValidElement(child)) : children;
	if (!isValidElement(element)) return null;
	// 元素 props 的类型是 unknown 记录，这里读的两个字段都由 react-markdown 自己的 DOM 约定给出。
	const props = element.props as { className?: unknown; children?: unknown };
	const raw = props.children;
	// 只有纯文本内容才交给代码块处理，其余保持默认渲染。
	if (typeof raw !== "string") return null;
	const className = typeof props.className === "string" ? props.className : "";
	const lang = /language-(\S+)/.exec(className)?.[1] ?? "";
	return { code: raw.replace(/\n$/, ""), lang };
}

const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang: string }) {
	const resolved = resolveLanguage(lang);
	// 语言加载完成和主题切换都会推进版本号；订阅它只为在这两个时机重新渲染。
	useSyncExternalStore(subscribeHighlight, highlightVersion);
	// 结果缓存在 lib/highlight.ts 里，命中时是同一个数组引用，这里不必再 memo。
	const tokens = resolved ? highlight(code, resolved) : null;
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (resolved) ensureLanguage(resolved);
	}, [resolved]);

	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 1500);
		return () => window.clearTimeout(timer);
	}, [copied]);

	return (
		<div className="code-block">
			<div className="code-block-head">
				<span className="code-block-lang">{lang || "text"}</span>
				<button
					type="button"
					className={cx("code-copy-btn", copied && "copied")}
					title={copied ? "Copied" : "Copy code"}
					aria-label={copied ? "Copied" : "Copy code"}
					onClick={() => {
						void navigator.clipboard.writeText(code).then(() => setCopied(true));
					}}
				>
					{copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
				</button>
			</div>
			<pre>
				<code>{tokens ? <TokenLines lines={tokens} /> : code}</code>
			</pre>
		</div>
	);
});

const TokenLines = memo(function TokenLines({ lines }: { lines: HighlightedCode }) {
	return <>{flattenTokens(lines)}</>;
});

/**
 * 把逐行 token 摊平成一串 span 和换行符。span 的 key 是它在整段代码里的字符
 * 偏移：同一段代码里唯一，也不随行数变化漂移。
 */
function flattenTokens(lines: HighlightedCode): ReactNode[] {
	const nodes: ReactNode[] = [];
	let offset = 0;
	for (const line of lines) {
		if (offset > 0) {
			nodes.push("\n");
			offset += 1;
		}
		for (const token of line) {
			nodes.push(
				<span key={offset} style={tokenStyle(token)}>
					{token.content}
				</span>,
			);
			offset += token.content.length;
		}
	}
	return nodes;
}

/** 表格包一层横向滚动容器，宽表格不撑破对话列。 */
function Table({ node: _node, children, ...rest }: ComponentProps<"table"> & { node?: unknown }) {
	return (
		<div className="table-wrap">
			<table {...rest}>{children}</table>
		</div>
	);
}

/** 一个顶层块，以及在整份源码里的起始偏移（流式追加时就是稳定的块 id）。 */
type Block = { offset: number; source: string };

/** 按空行切顶层块；围栏代码块内部的空行不是边界。 */
function splitBlocks(source: string): Block[] {
	if (CROSS_BLOCK_SYNTAX.test(source)) return [{ offset: 0, source }];
	const blocks: Block[] = [];
	let current: string[] = [];
	let currentStart = 0;
	let lineStart = 0;
	let fence: string | null = null;
	for (const line of source.split("\n")) {
		const match = FENCE.exec(line);
		if (match) {
			// 闭合围栏要同字符且不短于开启围栏，```` ``` `` ```` 里出现的 `~~~` 不算闭合。
			if (fence === null) fence = match[1];
			else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
		}
		if (fence === null && line.trim() === "") {
			if (current.length > 0) blocks.push({ offset: currentStart, source: current.join("\n") });
			current = [];
		} else {
			if (current.length === 0) currentStart = lineStart;
			current.push(line);
		}
		lineStart += line.length + 1;
	}
	if (current.length > 0) blocks.push({ offset: currentStart, source: current.join("\n") });
	return blocks;
}
