// 代码高亮：懒加载 shiki（JS 正则引擎，不碰 wasm），失败或未就绪时调用方渲染纯文本。

import type { HighlighterCore, ThemedToken } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/** 一行里的一个着色片段；只留渲染要用的属性，组件不必认识 shiki 的类型。 */
export type HighlightToken = {
	content: string;
	color: string | null;
	italic: boolean;
	bold: boolean;
};

export type HighlightedCode = readonly (readonly HighlightToken[])[];

/** fence tag 到 grammar 模块；模块列表写死，Vite 才不会打包整份语言目录。 */
const LANGUAGES = {
	typescript: () => import("@shikijs/langs/typescript"),
	tsx: () => import("@shikijs/langs/tsx"),
	javascript: () => import("@shikijs/langs/javascript"),
	jsx: () => import("@shikijs/langs/jsx"),
	json: () => import("@shikijs/langs/json"),
	python: () => import("@shikijs/langs/python"),
	bash: () => import("@shikijs/langs/bash"),
	css: () => import("@shikijs/langs/css"),
	html: () => import("@shikijs/langs/html"),
	yaml: () => import("@shikijs/langs/yaml"),
	go: () => import("@shikijs/langs/go"),
	rust: () => import("@shikijs/langs/rust"),
	markdown: () => import("@shikijs/langs/markdown"),
	sql: () => import("@shikijs/langs/sql"),
	diff: () => import("@shikijs/langs/diff"),
} as const;

export type LanguageId = keyof typeof LANGUAGES;

/** 同一门语言的常见 fence tag；未列出的 tag 一律当纯文本。 */
const ALIASES: Record<string, LanguageId> = {
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	sh: "bash",
	shell: "bash",
	shellscript: "bash",
	zsh: "bash",
	yml: "yaml",
	md: "markdown",
	rs: "rust",
	golang: "go",
};

const PLAIN = new Set(["", "text", "txt", "plain", "plaintext"]);

const THEMES = { dark: "github-dark", light: "github-light" } as const;

export type CodeTheme = (typeof THEMES)[keyof typeof THEMES];

/** 两个主题一起注册，切换主题只需要换 theme 名，不用重建 highlighter。 */
const THEME_MODULES = [import("@shikijs/themes/github-dark"), import("@shikijs/themes/github-light")];

/** 读根节点的 data-theme；App 在每次主题变化时写这个属性。 */
export function currentTheme(): CodeTheme {
	return document.documentElement.dataset.theme === "light" ? THEMES.light : THEMES.dark;
}

/** fence tag 到受支持的语言 id；纯文本、未知 tag 返回 null。 */
export function resolveLanguage(tag: string): LanguageId | null {
	const id = tag.trim().toLowerCase();
	if (PLAIN.has(id)) return null;
	// `in` 收窄不到键的类型，这里的一次断言由 LANGUAGES 的字面量键保证。
	if (id in LANGUAGES) return id as LanguageId;
	return ALIASES[id] ?? null;
}

const listeners = new Set<() => void>();
const ready = new Set<LanguageId>();
const loading = new Set<LanguageId>();
const failed = new Set<LanguageId>();

let instance: HighlighterCore | null = null;
let creating: Promise<HighlighterCore> | null = null;
let version = 0;
let observer: MutationObserver | null = null;

function notify(): void {
	version += 1;
	for (const listener of listeners) listener();
}

/** 订阅“语言就绪”和“主题变化”两种通知，配合 useSyncExternalStore 触发重新渲染。 */
export function subscribeHighlight(listener: () => void): () => void {
	if (!observer) {
		// 只观察 data-theme：根节点上还有 platform/density 等属性，与高亮无关。
		observer = new MutationObserver(notify);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** 单调递增的版本号：语言加载结束或主题切换后前进，作为 useSyncExternalStore 的快照。 */
export function highlightVersion(): number {
	return version;
}

function highlighter(): Promise<HighlighterCore> {
	creating ??= createHighlighterCore({
		themes: THEME_MODULES,
		langs: [],
		// JS 引擎省掉 wasm 资源，打包后不必带 .wasm 文件；宽容模式容忍少量正则倒退。
		engine: createJavaScriptRegexEngine({ forgiving: true }),
	}).then((created) => {
		instance = created;
		return created;
	});
	return creating;
}

/** 懒加载一种语言；重复调用只发起一次，加载失败的语言不再重试。 */
export function ensureLanguage(id: LanguageId): void {
	if (ready.has(id) || loading.has(id) || failed.has(id)) return;
	loading.add(id);
	void highlighter()
		.then((created) => created.loadLanguage(LANGUAGES[id]()))
		.then(() => {
			ready.add(id);
		})
		.catch(() => {
			// grammar 编译失败就永久回退纯文本，避免每次渲染重试同一个坏 grammar。
			failed.add(id);
		})
		.finally(() => {
			loading.delete(id);
			notify();
		});
}

// 流式代码块每帧都是一段新代码，键很快失效；按插入顺序淘汰，缓存不会无限长。
const CACHE_LIMIT = 120;
const cache = new Map<string, HighlightedCode>();

/** 高亮一段代码；语言还没就绪或解析失败时返回 null，由调用方渲染纯文本。 */
export function highlight(code: string, id: LanguageId): HighlightedCode | null {
	if (!instance || !ready.has(id)) return null;
	const theme = currentTheme();
	const key = `${theme}\u0000${id}\u0000${code}`;
	const cached = cache.get(key);
	if (cached) return cached;
	let lines: ThemedToken[][];
	try {
		lines = instance.codeToTokensBase(code, { lang: id, theme });
	} catch {
		return null;
	}
	const highlighted = lines.map(toHighlightLine);
	if (cache.size >= CACHE_LIMIT) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	cache.set(key, highlighted);
	return highlighted;
}

function toHighlightLine(tokens: readonly ThemedToken[]): readonly HighlightToken[] {
	return tokens.map((token) => {
		const fontStyle = token.fontStyle ?? 0;
		return {
			content: token.content,
			color: token.color ?? null,
			italic: (fontStyle & 1) !== 0,
			bold: (fontStyle & 2) !== 0,
		};
	});
}
