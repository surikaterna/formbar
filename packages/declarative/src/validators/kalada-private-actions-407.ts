import { type JsonValue, copyJson } from "@formbar/expressions";
import type {
	ActionResult407,
	ActionStatus407,
	ArrayActionHost407,
	ArrayOperation407,
	TrustedAction407,
} from "./kalada-action-contract-407.js";
import { committingLifecycle407 } from "./kalada-action-lifecycle-407.js";
import type { DataContext, EnumeratedRow, FormbarDataStrategyV1, ReadScope } from "./kalada-data-strategy.js";
import { OperationFence } from "./kalada-operation-fence.js";
import type { FrameReader } from "./kalada-prepared-view.js";
import { privateLifecycle } from "./kalada-private-lifecycle.js";
import { privateSubmission } from "./kalada-private-submission.js";
import type { StaticReference } from "./static-references.js";

export interface ActionDeclaration407 {
	readonly path: string;
	readonly action: string;
	readonly payload?: boolean;
	readonly concurrency?: "drop" | "replace" | "queue";
	readonly target?: StaticReference;
	readonly minItems?: number;
	readonly maxItems?: number;
}
export interface ActionInstallation407 {
	readonly strategy: FormbarDataStrategyV1;
	readonly context: DataContext;
	readonly live: () => boolean;
	readonly installationLive?: () => boolean;
	readonly trackOperation?: (cancel: () => void) => () => void;
	readonly frame: FrameReader;
	readonly capture?: () => FrameReader;
	readonly scope: ReadScope;
	readonly row?: EnumeratedRow;
	readonly declaration: ActionDeclaration407;
	readonly arrayHost?: ArrayActionHost407;
	readonly handlers?: Readonly<Record<string, TrustedAction407>>;
	readonly submit?: (operation?: OperationFence) => Promise<{ readonly status: ActionStatus407 }>;
	readonly validate?: (operation: OperationFence) => Promise<{ readonly ok: boolean; readonly code?: string }>;
	/** Re-evaluates current visibility, disabled/readOnly, policy and target grant at use time. */
	readonly allowed: () => boolean;
}
const arrays = new Set<string>(["array.append", "array.insert", "array.remove", "array.move", "array.swap"]);
const needsPayload = new Set<string>(["array.append", "array.insert", "array.move", "array.swap"]);

/** An action owns exactly one rendered frame, bounded queue and abort lifetime. */
class InstalledAction407 {
	private readonly revision: object | undefined;
	private readonly scope: ReadScope;
	private disposed = false;
	private terminal = false;
	private activeOperation: OperationFence | undefined;
	private submitted = false;
	private active: AbortController | undefined;
	private readonly replaced = new WeakSet<AbortController>();
	private readonly committed = new WeakSet<AbortSignal>();
	private readonly waiting: { run: () => void; cancel: () => void }[] = [];
	private readonly unsubscribe: () => void;
	constructor(private readonly options: ActionInstallation407) {
		this.revision = options.frame.revision();
		this.scope = Object.freeze({
			rows: Object.freeze(options.scope.rows.map(({ name, token }) => Object.freeze({ name, token }))),
		});
		this.unsubscribe = options.strategy.subscribe(options.context, () => {
			try {
				if (this.fresh()) return;
			} catch {
				/* A throwing host cannot keep pending callbacks alive. */
			}
			if (!this.activeOperation?.fresh()) this.active?.abort();
			for (const entry of this.waiting.splice(0)) entry.cancel();
		});
	}
	private get declaration() {
		return this.options.declaration;
	}
	private fresh() {
		return (
			!this.disposed &&
			!!this.revision &&
			this.options.live() &&
			this.options.strategy.current(this.options.context) === this.revision
		);
	}
	private fail(status: ActionStatus407, path = this.declaration.path): ActionResult407 {
		return { path, status };
	}
	private payload(): { ok: true; value?: JsonValue } | { ok: false } {
		if (!this.declaration.payload) return { ok: true };
		for (let attempt = 0; attempt < 2; attempt++) {
			if (!this.fresh()) return { ok: false };
			const frame = this.options.capture?.() ?? this.options.frame;
			if (frame.revision() !== this.revision) return { ok: false };
			const evaluated = frame.evaluate(`${this.declaration.path}.payload`, this.scope);
			if (!evaluated.ok) {
				if (frame.revision() === undefined && this.fresh()) continue;
				return { ok: false };
			}
			try {
				return { ok: true, value: copyJson(evaluated.value) };
			} catch {
				return { ok: false };
			}
		}
		return { ok: false };
	}
	private array(
		value: JsonValue | undefined,
		destination: EnumeratedRow | undefined,
		operationFence: OperationFence,
	): ActionResult407 {
		const { arrayHost, row, context } = this.options;
		const d = this.declaration;
		if (!arrayHost || !d.target) return this.fail("unsupported", `${d.path}.target`);
		const ownRow =
			row && !d.target.path.some((part) => typeof part === "object" && part.row === this.scope.rows.at(-1)?.name)
				? row
				: undefined;
		const operation = d.action as ArrayOperation407;
		if (
			["array.remove", "array.move", "array.swap"].includes(operation) &&
			(!ownRow?.writeRevision || ownRow.formRevision !== this.revision)
		)
			return this.fail("invalid");
		if (
			["array.move", "array.swap", "array.insert"].includes(operation) &&
			(!destination?.writeRevision || destination.formRevision !== this.revision)
		)
			return this.fail("invalid");
		const result = arrayHost.mutateArray(context, {
			contract: "formbar-array-action-v1",
			operation,
			operationFence,
			target: d.target,
			instance: context.instance,
			revision: this.revision as object,
			scope: this.scope,
			...(ownRow ? { row: { token: ownRow.token, revision: ownRow.writeRevision as object } } : {}),
			...(destination
				? { destination: { token: destination.token, revision: destination.writeRevision as object } }
				: {}),
			...(value === undefined ? {} : { payload: value }),
			...(d.minItems === undefined ? {} : { minItems: d.minItems }),
			...(d.maxItems === undefined ? {} : { maxItems: d.maxItems }),
		});
		const revision = this.options.strategy.current(context);
		return {
			...this.fail(result.status),
			...(result.status === "applied" && operationFence.hasCommitted() && revision && revision !== this.revision
				? { mutation: { revision } }
				: {}),
		};
	}
	private async submission(signal: AbortSignal, live: () => boolean, operation: OperationFence) {
		if (this.submitted) return this.fail("dropped");
		const outcome = await (this.options.submit
			? this.options.submit(operation)
			: privateSubmission(this.options.strategy, this.options.context, () => live() && this.fresh()).submit(operation));
		if (outcome.status === "submitted" && (operation.hasCommitted() || !operation.signal.aborted)) {
			this.submitted = true;
			this.committed.add(signal);
		}
		return signal.aborted && !this.committed.has(signal) ? this.fail("replaced") : this.fail(outcome.status);
	}
	private async handler(signal: AbortSignal, value: JsonValue | undefined, operation: OperationFence) {
		const handler = this.options.handlers?.[this.declaration.action];
		const validate = this.options.validate;
		if (!handler) return this.fail("unsupported", `${this.declaration.path}.action`);
		const outcome = await handler({
			path: this.declaration.path,
			instance: this.options.context.instance,
			revision: this.revision as object,
			...(value === undefined ? {} : { payload: value }),
			signal: operation.signal,
			fresh: () => operation.fresh(),
			...(validate ? { validate: () => validate(operation) } : {}),
		});
		if (outcome.status === "applied" && operation.fresh()) this.committed.add(signal);
		return operation.signal.aborted || !operation.fresh() ? this.fail("stale") : this.fail(outcome.status);
	}
	private async lifecycle(signal: AbortSignal, live: () => boolean) {
		const strategy = committingLifecycle407(this.options.strategy, () => this.committed.add(signal));
		const lifecycle = privateLifecycle(strategy, this.options.context, () => this.committed.has(signal) || live());
		const outcome = this.declaration.action === "reset" ? lifecycle.reset() : await lifecycle.validate();
		if (signal.aborted && !this.committed.has(signal)) return this.fail("replaced");
		return !outcome.ok
			? this.fail(outcome.code === "LIFECYCLE_UNAVAILABLE" ? "unsupported" : "stale", `${this.declaration.path}.action`)
			: this.fail("applied");
	}
	private async perform(
		signal: AbortSignal,
		operation: OperationFence,
		destination?: EnumeratedRow,
	): Promise<ActionResult407> {
		try {
			const live = () => !signal.aborted && !this.disposed && this.options.live() && this.options.allowed();
			const d = this.declaration;
			if (!this.fresh()) return this.fail("stale");
			if (!this.options.allowed()) return this.fail("denied");
			if (needsPayload.has(d.action) && !d.payload) return this.fail("invalid", `${d.path}.payload`);
			if (["submit", "reset", "validate"].includes(d.action) && d.payload)
				return this.fail("invalid", `${d.path}.payload`);
			const read = this.payload();
			if (!read.ok) return this.fail("invalid", `${d.path}.payload`);
			if (!this.fresh() || signal.aborted) return this.fail("stale");
			if (arrays.has(d.action)) {
				const outcome = this.array(read.value, destination, operation);
				// Own synchronous commits retire their rendered frame without undoing success.
				if (outcome.status === "applied") this.committed.add(signal);
				return outcome;
			}
			if (d.action === "reset" || d.action === "validate") return await this.lifecycle(signal, live);
			if (d.action === "submit") return await this.submission(signal, live, operation);
			return await this.handler(signal, read.value, operation);
		} catch {
			return this.fail("error");
		}
	}
	private dispatch(destination?: EnumeratedRow): Promise<ActionResult407> {
		if (!this.fresh()) return Promise.resolve(this.fail("stale"));
		if (this.active && this.declaration.concurrency !== "replace") {
			if (this.declaration.concurrency !== "queue") return Promise.resolve(this.fail("dropped"));
			if (this.waiting.length >= 16) return Promise.resolve(this.fail("queue-full"));
			return new Promise((resolve) =>
				this.waiting.push({
					run: () => this.start(destination).then(resolve),
					cancel: () => resolve(this.fail("stale")),
				}),
			);
		}
		if (this.active) {
			this.replaced.add(this.active);
			this.active.abort();
		}
		return this.start(destination);
	}
	private start(destination?: EnumeratedRow): Promise<ActionResult407> {
		const controller = new AbortController();
		this.active = controller;
		const operation = new OperationFence(
			this.options.strategy,
			this.options.context,
			this.revision as object,
			() => !this.terminal && (this.options.installationLive?.() ?? this.options.live()),
			this.options.allowed,
			this.declaration.concurrency,
			false,
		);
		this.activeOperation = operation;
		controller.signal.addEventListener("abort", () => operation.cancel(), { once: true });
		const untrack = this.options.trackOperation?.(() => {
			controller.abort();
			operation.cancel();
		});
		return this.perform(controller.signal, operation, destination).then((outcome) => {
			if (this.active === controller) {
				this.active = undefined;
				this.activeOperation = undefined;
				this.waiting.shift()?.run();
			}
			const result =
				controller.signal.aborted && !this.committed.has(controller.signal)
					? this.fail(this.replaced.has(controller) ? "replaced" : "stale")
					: outcome;
			operation.dispose();
			if (this.disposed) this.unsubscribe();
			untrack?.();
			return result;
		});
	}
	private dispose() {
		if (this.terminal) return;
		this.terminal = true;
		this.disposed = true;
		this.active?.abort();
		for (const entry of this.waiting.splice(0)) entry.cancel();
		this.unsubscribe();
	}
	binding() {
		return {
			invoke: (destination?: EnumeratedRow) => this.dispatch(destination),
			pending: () => !!this.active,
			dispose: () => this.dispose(),
			retire: () => {
				this.disposed = true;
				if (!this.activeOperation?.fresh()) this.active?.abort();
				if (!this.active) this.unsubscribe();
			},
		};
	}
}

export function installPrivateAction407(options: ActionInstallation407) {
	return new InstalledAction407(options).binding();
}
