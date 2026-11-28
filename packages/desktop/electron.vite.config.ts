// electron-vite build config: main as ESM, preload as CJS, renderer through vite + React.

import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			rollupOptions: {
				input: { index: resolve(import.meta.dirname, "src/main/index.ts") },
				// pi resolves from node_modules at runtime: its dist ships the SDK, so keep it out of the bundle.
				external: ["electron", /^@earendil-works\/pi-coding-agent(\/.*)?$/],
				output: { format: "es", entryFileNames: "index.js" },
			},
		},
	},
	preload: {
		build: {
			rollupOptions: {
				// 通知窗口有自己的一份桥：它只接卡片，不接对话命令。
				input: {
					index: resolve(import.meta.dirname, "src/preload/index.ts"),
					notification: resolve(import.meta.dirname, "src/preload/notification.ts"),
				},
				external: ["electron"],
				output: { format: "cjs", entryFileNames: "[name].cjs" },
			},
		},
	},
	renderer: {
		root: ".",
		plugins: [react()],
		build: {
			rollupOptions: {
				input: {
					index: resolve(import.meta.dirname, "index.html"),
					// 右下角通知是独立页面：它跑在自己的窗口里，主题与文案都从主进程推过来。
					notification: resolve(import.meta.dirname, "notification.html"),
				},
			},
		},
	},
});
