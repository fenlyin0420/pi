// Vitest config for the desktop package: tests are pure mapping tests with hand-written pi-shaped fixtures.

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
	},
});
