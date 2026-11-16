// 设置文件的单元测试：workspace 列表与选中项，以及旧版本 recentProjects 的迁移。

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SettingsStore } from "../src/main/settings.ts";

function settingsDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-desktop-settings-"));
}

function storeFrom(payload: unknown): SettingsStore {
	const directory = settingsDir();
	writeFileSync(join(directory, "settings.json"), JSON.stringify(payload), "utf8");
	return new SettingsStore(directory);
}

describe("SettingsStore workspaces", () => {
	it("空目录时没有 workspace，也没选中任何一个", () => {
		const settings = new SettingsStore(settingsDir()).get();
		expect(settings.workspaces).toEqual([]);
		expect(settings.activeWorkspace).toBeNull();
	});

	it("旧版本只存 recentProjects，读盘时它成为 workspace 列表", () => {
		const settings = storeFrom({
			version: 1,
			settings: { recentProjects: ["D:\\GitHub\\pi", "D:\\home\\fenlyin"] },
			window: {},
		}).get();
		expect(settings.workspaces).toEqual(["D:\\GitHub\\pi", "D:\\home\\fenlyin"]);
	});

	it("加入 workspace 去重且保持加入顺序", () => {
		const store = new SettingsStore(settingsDir());
		store.addWorkspace("D:\\GitHub\\pi");
		store.addWorkspace("D:\\GitHub\\pi");
		store.addWorkspace("D:\\home\\fenlyin");
		expect(store.get().workspaces).toEqual(["D:\\GitHub\\pi", "D:\\home\\fenlyin"]);
	});

	it("选中项可以被记住，也可以清空", () => {
		const store = new SettingsStore(settingsDir());
		store.setActiveWorkspace("D:\\GitHub\\pi");
		expect(store.get().activeWorkspace).toBe("D:\\GitHub\\pi");
		store.setActiveWorkspace(null);
		expect(store.get().activeWorkspace).toBeNull();
	});

	it("非字符串条目被丢掉，非字符串选中项退回 null", () => {
		const settings = storeFrom({
			version: 2,
			settings: { workspaces: ["/srv/pi", 7, null, "/srv/pi"], activeWorkspace: 42 },
			window: {},
		}).get();
		expect(settings.workspaces).toEqual(["/srv/pi"]);
		expect(settings.activeWorkspace).toBeNull();
	});

	it("默认设置里没有 workspace", () => {
		expect(DEFAULT_SETTINGS.workspaces).toEqual([]);
		expect(DEFAULT_SETTINGS.activeWorkspace).toBeNull();
	});
});

describe("SettingsStore immersiveSessions", () => {
	it("默认没有沉浸会话", () => {
		expect(DEFAULT_SETTINGS.immersiveSessions).toEqual([]);
	});

	it("去重、丢掉非字符串，并按该上限截断", () => {
		const settings = storeFrom({
			version: 2,
			settings: { immersiveSessions: ["a", "a", 7, null, "b", ""] },
			window: {},
		}).get();
		expect(settings.immersiveSessions).toEqual(["a", "b"]);
	});

	it("超过上限的部分不保留", () => {
		const many = Array.from({ length: 600 }, (_, index) => `session-${index}`);
		const settings = storeFrom({ version: 2, settings: { immersiveSessions: many }, window: {} }).get();
		expect(settings.immersiveSessions).toHaveLength(500);
		expect(settings.immersiveSessions.at(-1)).toBe("session-499");
	});
});
