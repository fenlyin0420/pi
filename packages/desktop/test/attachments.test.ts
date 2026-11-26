// 附件读取的单元测试：图片按文件头认格式并读成 base64，其余只留路径，读不了的说清原因。

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAttachments } from "../src/main/attachments.ts";
import { MAX_ATTACHMENTS } from "../src/shared/contract.ts";

/** 只认文件头的检测器不校验图片正文，签名够了就能测出分类。 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

let root = "";

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "pi-desktop-attachments-"));
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

describe("readAttachments", () => {
	it("图片读成 base64 附件，带上名字、路径和大小", async () => {
		const path = await write("shot.png", PNG);
		const { attachments, rejected } = await readAttachments([path]);
		expect(rejected).toEqual([]);
		expect(attachments).toEqual([
			{
				kind: "image",
				name: "shot.png",
				path,
				mimeType: "image/png",
				data: PNG.toString("base64"),
				size: PNG.length,
			},
		]);
	});

	it("非图片只留路径，不读正文", async () => {
		const path = await write("notes.txt", "hello");
		const { attachments } = await readAttachments([path]);
		expect(attachments).toEqual([{ kind: "file", name: "notes.txt", path, size: 5 }]);
	});

	it("目录和读不到的路径都跳过并说明原因", async () => {
		const directory = join(root, "folder");
		await mkdir(directory, { recursive: true });
		const { attachments, rejected } = await readAttachments([directory, join(root, "missing.pdf")]);
		expect(attachments).toEqual([]);
		expect(rejected).toEqual(["folder is a folder.", "missing.pdf can't be read."]);
	});

	it("超过上限的部分不读，只报一次上限", async () => {
		const paths = await Promise.all(
			Array.from({ length: MAX_ATTACHMENTS + 2 }, (_unused, index) => write(`many-${index}.txt`, `${index}`)),
		);
		const { attachments, rejected } = await readAttachments(paths);
		expect(attachments).toHaveLength(MAX_ATTACHMENTS);
		expect(rejected).toEqual([`At most ${MAX_ATTACHMENTS} attachments per message.`]);
	});

	it("空路径列表什么都不读", async () => {
		expect(await readAttachments([])).toEqual({ attachments: [], rejected: [] });
	});
});
