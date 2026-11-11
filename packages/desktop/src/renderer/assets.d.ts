// Vite 的静态资源默认导出：图片和非 CSS 资源按 URL 处理。

declare module "*.webp" {
	const src: string;
	export default src;
}

declare module "*.png" {
	const src: string;
	export default src;
}
