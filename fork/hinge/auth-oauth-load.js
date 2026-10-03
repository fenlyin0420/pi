// fork 载体 · S2 汇聚点替身：OAuth 登录流加载器
//
// 上游源码 packages/ai/src/auth/oauth/load.ts 保持原样；本文件在构建时覆盖
// packages/ai/dist/auth/oauth/load.js（原件改名为 load.orig.js，仅作 .d.ts 类型链的锚点）。
//
// 作用：这是所有 OAuth 登录流的唯一入口（其它模块只 import 这个文件，
// 各流实现本身靠变量 specifier 动态 import，打包器跟不进去）。把它变成"立刻失败"后：
//   · 任何登录尝试都会得到明确错误，不再可能完成 OAuth 登录；
//   · 各流实现文件在 dist 里无人引用，可安全剪枝。
//
// 契约：导出集合必须与上游 load.js 完全一致（assertions.mjs 会逐一比对）。

const DISABLED_MESSAGE = "OAuth login is disabled in this build.";

const disabled = async () => {
	throw new Error(DISABLED_MESSAGE);
};

export function registerBundledOAuthFlowLoaders() {
	// 上游用它给 Bun 单文件二进制注册内嵌的流；本构建不内嵌任何流。
}

export const loadAnthropicOAuth = disabled;
export const loadOpenAICodexOAuth = disabled;
export const loadOpenAIChatGPTOAuth = disabled;
export const loadGitHubCopilotOAuth = disabled;
export const loadOpenRouterOAuth = disabled;
export const loadKimiCodingOAuth = disabled;
export const loadMetaOAuth = disabled;
export const loadXaiOAuth = disabled;
export const loadRadiusOAuth = disabled;
