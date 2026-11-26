// 排队消息投影的单元测试：正文与附件块分开、顺序保留、key 稳定。

import { describe, expect, it } from "vitest";
import { pendingLines } from "../src/renderer/lib/pending.ts";

describe("pendingLines", () => {
	it("把一条普通正文压成一行，不带附件", () => {
		expect(pendingLines(["先别动 schema"])).toEqual([{ key: "pending-0", text: "先别动 schema", files: [] }]);
	});

	it("剥掉正文里的附件块，路径单独成 files", () => {
		const raw = "看这两个文件\n\n<attached-files>\n/tmp/a.ts\n/tmp/b.ts\n</attached-files>";
		const [line] = pendingLines([raw]);
		expect(line?.text).toBe("看这两个文件");
		expect(line?.files).toEqual(["/tmp/a.ts", "/tmp/b.ts"]);
	});

	it("按队列顺序逐条给出，key 跟着位置走", () => {
		const lines = pendingLines(["一", "二"]);
		expect(lines.map((line) => line.text)).toEqual(["一", "二"]);
		expect(lines.map((line) => line.key)).toEqual(["pending-0", "pending-1"]);
	});

	it("空队列给空数组", () => {
		expect(pendingLines([])).toEqual([]);
	});
});
