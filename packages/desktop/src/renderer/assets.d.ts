// Vite 的静态资源默认导出：图片和非 CSS 资源按 URL 处理。
// CSS 只有副作用导入，类型由这里声明，避免 tsc 报 TS2882。

declare module "*.css";

declare module "*.wav" {
	const src: string;
	export default src;
}

declare module "*.webp" {
	const src: string;
	export default src;
}

declare module "*.png" {
	const src: string;
	export default src;
}
