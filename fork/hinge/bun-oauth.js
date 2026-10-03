// fork 载体 · S2 汇聚点替身：Bun 二进制的 OAuth 注册入口
//
// 上游源码 packages/ai/src/bun-oauth.ts 静态 import 了全部 OAuth 流实现，
// 是它们在 dist 里唯一的静态引用者。把它变成 no-op 之后，那些流实现就无人引用 → 可剪枝。
//
// 契约：导出 registerBunOAuthFlows（无参、无返回）。

export function registerBunOAuthFlows() {
	// 本构建不内嵌 OAuth 流。
}
