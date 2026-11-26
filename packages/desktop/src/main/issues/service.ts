// issues 的宿主侧门面：IPC 命令、快照里的列表、选中项的详情、线程会话的工具注入。

import type { DesktopCommand, DesktopEvent, IssueRunView, IssueSummary } from "../../shared/contract.ts";
import { IssueRunner } from "./runner.ts";
import { type IssueRecord, IssueStore } from "./store.ts";
import { createIssueTools } from "./tools.ts";
import { toIssueDetail, toIssueSummary } from "./view.ts";

export type IssuesServiceDeps = {
	/** userData 目录：issues.json 就落在里面。 */
	directory: string;
	emit(event: DesktopEvent): void;
	/** 当前 workspace；null 时不能建 issue，也不该跑队列。 */
	workspace(): string | null;
	/** 同时跑几条 issue（1–5，来自设置）。 */
	concurrency(): number;
	session: {
		ensure(issue: IssueRecord): Promise<string>;
		prompt(sessionId: string, text: string): Promise<void>;
		abort(sessionId: string): Promise<void>;
		open(sessionId: string): Promise<void>;
	};
	/** 快照需要重发（issue 列表在 DesktopState 里）。 */
	changed(): void;
	notify(level: "info" | "warning" | "error", message: string): void;
};

/** 全部 workspace 的 issue 与推进器；界面按当前 workspace 过滤列表。 */
export class IssuesService {
	private readonly deps: IssuesServiceDeps;
	private readonly store: IssueStore;
	private readonly runner: IssueRunner;

	constructor(deps: IssuesServiceDeps) {
		this.deps = deps;
		this.store = new IssueStore(deps.directory);
		this.runner = new IssueRunner(this.store, {
			ensureSession: (issue) => deps.session.ensure(issue),
			prompt: (sessionId, text) => deps.session.prompt(sessionId, text),
			abort: (sessionId) => deps.session.abort(sessionId),
			notify: (level, message) => deps.notify(level, message),
			changed: () => deps.changed(),
			concurrency: () => deps.concurrency(),
		});
	}

	summaries(): IssueSummary[] {
		return this.store.list().map(toIssueSummary);
	}

	runView(): IssueRunView {
		return this.runner.view();
	}

	/** 这条会话属于某条 issue 时给它挂 issue 工具，普通会话一条都不挂。 */
	toolsForSession(sessionId: string): ReturnType<typeof createIssueTools> {
		const record = this.store.bySession(sessionId);
		return record ? this.toolsForIssue(record.id) : [];
	}

	toolsForIssue(issueId: string): ReturnType<typeof createIssueTools> {
		return createIssueTools(issueId, {
			store: this.store,
			onChange: () => {
				this.emitDetail(issueId);
				this.deps.changed();
			},
		});
	}

	/** 处理 issue 相关命令；不是这一类时返回 false，由调用方继续往下分派。 */
	async handle(command: DesktopCommand): Promise<boolean> {
		switch (command.type) {
			case "createIssue":
				this.create(command.title, command.body);
				return true;
			case "updateIssue":
				this.store.update(command.id, { title: command.title, body: command.body });
				this.emitDetail(command.id);
				this.deps.changed();
				return true;
			case "commentIssue":
				this.store.comment(command.id, "user", command.text);
				this.emitDetail(command.id);
				this.deps.changed();
				return true;
			case "deleteIssue":
				if (this.runner.view().running.includes(command.id)) {
					this.deps.notify("warning", "Stop the run before deleting this issue.");
					return true;
				}
				this.store.remove(command.id);
				this.deps.emit({ type: "issueDetail", detail: null });
				this.deps.changed();
				return true;
			case "setIssueQueue":
				this.setQueue(command.ids, command.queued);
				return true;
			case "reopenIssue":
				this.transition(command.id, ["closed"], "open");
				this.deps.changed();
				return true;
			case "closeIssue":
				this.transition(command.id, ["open", "queued", "review"], "closed");
				this.deps.changed();
				return true;
			case "selectIssue":
				this.emitDetail(command.id);
				return true;
			case "openIssueThread":
				await this.openThread(command.id);
				return true;
			case "runIssues":
				await this.run(command.action);
				return true;
			default:
				return false;
		}
	}

	/** 会话被用户删掉：issue 保留，线程引用清空，下次运行重建。 */
	detachSession(sessionId: string): void {
		this.store.detachSession(sessionId);
	}

	flush(): void {
		this.store.flush();
	}

	private create(title: string, body: string): void {
		const workspace = this.deps.workspace();
		if (!workspace) {
			this.deps.notify("warning", "Select a workspace before creating an issue.");
			return;
		}
		const trimmed = title.trim();
		if (!trimmed) {
			this.deps.notify("warning", "An issue needs a title.");
			return;
		}
		const record = this.store.create(workspace, trimmed, body);
		this.emitDetail(record.id);
		this.deps.changed();
	}

	/**
	 * 状态迁移的白名单：界面只点得到这些，模型没有直接改状态的路径。
	 * 不改写正文，所以不发 issueDetail：界面上的状态一律从快照读。
	 */
	private transition(id: string, from: readonly string[], to: "open" | "queued" | "closed"): void {
		const record = this.store.byId(id);
		if (!record || !from.includes(record.status)) return;
		this.store.setStatus(id, to, { blocked: to === "open" ? record.blocked : null, error: null });
	}

	/** 复选框与全选：勾上入队（open/review → queued），取消出队（queued → open）。 */
	private setQueue(ids: readonly string[], queued: boolean): void {
		for (const id of ids) {
			if (queued) this.transition(id, ["open", "review"], "queued");
			else this.transition(id, ["queued"], "open");
		}
		this.deps.changed();
	}

	private async openThread(id: string): Promise<void> {
		const sessionId = this.store.byId(id)?.sessionId;
		if (!sessionId) {
			this.deps.notify("warning", "This issue has no thread yet; queue it to start one.");
			return;
		}
		await this.deps.session.open(sessionId);
	}

	private async run(action: "start" | "pause" | "stop"): Promise<void> {
		if (action === "pause") {
			this.runner.pause();
			return;
		}
		if (action === "stop") {
			await this.runner.stop();
			return;
		}
		this.runner.start();
	}

	private emitDetail(id: string): void {
		const record = this.store.byId(id);
		this.deps.emit({ type: "issueDetail", detail: record ? toIssueDetail(record) : null });
	}
}
