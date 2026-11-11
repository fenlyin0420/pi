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
				input: { index: resolve(import.meta.dirname, "src/preload/index.ts") },
				external: ["electron"],
				output: { format: "cjs", entryFileNames: "index.cjs" },
			},
		},
	},
	renderer: {
		root: ".",
		plugins: [react()],
		build: {
			rollupOptions: {
				input: { index: resolve(import.meta.dirname, "index.html") },
			},
		},
	},
});
