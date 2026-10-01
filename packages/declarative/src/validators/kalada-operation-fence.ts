import type { DataContext, FormbarDataStrategyV1, OperationFenceV1 } from "./kalada-data-strategy.js";

/** Only a checked, unchanged-data owned validation may advance a running operation's revision. */
export class OperationFence implements OperationFenceV1 {
	private readonly controller = new AbortController();
	private revision: object;
	private closed = false;
	private committed = false;
	private validationData: string | undefined;
	private readonly unsubscribe: () => void;
	constructor(
		private readonly strategy: FormbarDataStrategyV1,
		private readonly context: DataContext,
		revision: object,
		private readonly live: () => boolean,
		private readonly allowed: () => boolean,
		readonly concurrency?: "drop" | "replace" | "queue",
		listen = true,
	) {
		this.revision = revision;
		this.unsubscribe = listen
			? strategy.subscribe(context, () => {
					if (!this.committed && !this.fresh()) this.cancel();
				})
			: () => {};
	}
	get signal() {
		return this.controller.signal;
	}
	fresh() {
		return (
			!this.closed &&
			!this.signal.aborted &&
			this.live() &&
			this.allowed() &&
			this.strategy.current(this.context) === this.revision
		);
	}
	beginValidation() {
		if (!this.fresh()) return false;
		const capture = this.strategy.captureSubmission?.(this.context);
		if (capture?.status !== "found" || capture.instance !== this.context.instance || capture.revision !== this.revision)
			return false;
		this.validationData = JSON.stringify(capture.data);
		return true;
	}
	advance(revision: object) {
		if (this.closed || this.signal.aborted || !this.live() || !this.allowed() || this.validationData === undefined)
			return false;
		const capture = this.strategy.captureSubmission?.(this.context);
		if (
			capture?.status !== "found" ||
			capture.instance !== this.context.instance ||
			capture.revision !== revision ||
			this.strategy.current(this.context) !== revision ||
			JSON.stringify(capture.data) !== this.validationData
		)
			return false;
		this.revision = revision;
		this.validationData = undefined;
		return true;
	}
	complete() {
		if (!this.fresh()) return false;
		this.committed = true;
		this.unsubscribe();
		return true;
	}
	hasCommitted() {
		return this.committed;
	}
	cancel() {
		if (!this.committed) this.controller.abort();
	}
	dispose() {
		this.closed = true;
		this.cancel();
		this.unsubscribe();
	}
}
