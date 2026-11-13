// 点开附件的单元测试：图片读出 data URL 交给内置查看器，其余（文本、目录、过大、缺失）都返回 null。

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readImageView } from "../src/main/attachment-open.ts";
import { MAX_IMAGE_BYTES } from "../src/main/attachments.ts";

/** 只认文件头的检测器不校验图片正文，签名够了就能测出分类。 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

let root = "";

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "pi-desktop-attachment-open-"));
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

/** 在临时目录里落一个文件并返回绝对路径。 */
async function write(name: string, content: string | Buffer): Promise<string> {
	const path = join(root, name);
	await writeFile(path, content);
	return path;
}

describe("readImageView", () => {
	it("图片读出 data URL，带上路径和名字", async () => {
		const path = await write("shot.png", PNG);
		expect(await readImageView(path)).toEqual({
			path,
			name: "shot.png",
			dataUrl: `data:image/png;base64,${PNG.toString("base64")}`,
		});
	});

	it("文本不给查看器，交给系统默认程序", async () => {
		expect(await readImageView(await write("notes.txt", "hello"))).toBeNull();
	});

	it("目录、缺失的路径和超过上限的图片都不给查看器", async () => {
		const directory = join(root, "folder");
		await mkdir(directory, { recursive: true });
		const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
		expect(await readImageView(directory)).toBeNull();
		expect(await readImageView(join(root, "missing.png"))).toBeNull();
		expect(await readImageView(await write("big.png", big))).toBeNull();
	});
});
