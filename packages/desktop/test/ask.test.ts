// pi-ask 事件桥的单元测试：wire 数据校验成界面契约，答案映射回提交载荷。

import { describe, expect, it } from "vitest";
import { flowIdOf, toAskRequest, toSubmitPayload } from "../src/main/ask.ts";

const started = {
	version: 1,
	flowId: "flow-1",
	source: "tool",
	title: "  Pick one  ",
	createdAt: 1234,
	questions: [
		{
			id: "color",
			label: "Color",
			prompt: "Which color?",
			type: "single",
			required: true,
			options: [
				{ value: "green", label: "Green", description: "Fresh", recommended: true },
				{ value: "red", label: "Red" },
			],
		},
	],
};

describe("toAskRequest", () => {
	it("把 started 事件读成界面契约", () => {
		const request = toAskRequest(started);
		expect(request).toMatchObject({ flowId: "flow-1", title: "Pick one", createdAt: 1234 });
		expect(request?.questions).toHaveLength(1);
		expect(request?.questions[0]).toMatchObject({
			id: "color",
			type: "single",
			required: true,
			freeform: false,
			options: [
				{ value: "green", label: "Green", description: "Fresh", recommended: true },
				{ value: "red", label: "Red" },
			],
		});
	});

	it("preview 题型或带 freeform 选项时允许自填", () => {
		const preview = toAskRequest({ ...started, questions: [{ ...started.questions[0], type: "preview" }] });
		expect(preview?.questions[0].freeform).toBe(true);

		const freeform = toAskRequest({
			...started,
			questions: [{ ...started.questions[0], options: [{ value: "a", label: "A", freeform: true }] }],
		});
		expect(freeform?.questions[0].freeform).toBe(true);
	});

	it("缺字段或坏选项整条丢弃", () => {
		expect(toAskRequest(null)).toBeNull();
		expect(toAskRequest({ ...started, flowId: "" })).toBeNull();
		expect(toAskRequest({ ...started, questions: [] })).toBeNull();
		expect(toAskRequest({ ...started, questions: [{ id: "x" }] })).toBeNull();
		expect(
			toAskRequest({ ...started, questions: [{ ...started.questions[0], options: [{ label: "no value" }] }] }),
		).toBeNull();
	});

	it("类型不认识时按单选处理，required 缺省为必答", () => {
		const request = toAskRequest({
			...started,
			questions: [{ id: "q", prompt: "p", type: "weird", options: [{ value: "a", label: "A" }] }],
		});
		expect(request?.questions[0]).toMatchObject({ type: "single", required: true, label: "Question" });
	});
});

describe("flowIdOf", () => {
	it("只从带 flowId 的记录里取值", () => {
		expect(flowIdOf({ flowId: "f" })).toBe("f");
		expect(flowIdOf({ flowId: "" })).toBeNull();
		expect(flowIdOf("f")).toBeNull();
		expect(flowIdOf(null)).toBeNull();
	});
});

describe("toSubmitPayload", () => {
	it("按题目 id 收拢作答，丢掉空字段", () => {
		const payload = toSubmitPayload("flow-1", {
			color: { values: ["green"] },
			size: { values: [], customText: "   ", note: "" },
			extra: { customText: " something " },
		});
		expect(payload.response.answers).toEqual({ color: { values: ["green"] }, extra: { customText: "something" } });
		expect(payload.flowId).toBe("flow-1");
		expect(payload.version).toBe(1);
		expect("note" in payload.response).toBe(false);
	});

	it("整次提问的备注只在非空时出现", () => {
		const withNote = toSubmitPayload("flow-1", { color: { values: ["green"] } }, "  overall note ");
		expect(withNote.response.note).toBe("overall note");
	});
});
