import type { FormApi } from "./contracts.js";
import type { AbsoluteDataPath } from "./field-policy.js";
import type { DataPathInput } from "./field-policy.js";
import { normalizeDataPath } from "./field-policy.js";
import { parsePath } from "./path-parser.js";
import type { CanonicalSegment } from "./path.js";
import { type AsyncProjection, runScopedAsyncField } from "./scoped-async-execution.js";
import { type ScopedAsyncField, scopedAsyncHost } from "./scoped-async.js";
import type { FormState, FormStateCapture, ValidationIssue } from "./state.js";
import { DEFAULT_RUNTIME_CONSTRAINTS } from "./timeout.js";
import { normalizeIssues } from "./validation.js";

type Trigger = "onChange" | "onBlur";
type Capture<TData, TUi> = FormStateCapture<TData, TUi>;
type Projection<TData, TUi> = ReturnType<NonNullable<ReturnType<typeof scopedAsyncHost<TData, TUi>>>["instances"]>;

interface Pending<TData, TUi> {
	readonly field: ScopedAsyncField;
	readonly key: string;
	readonly capture: Capture<TData, TUi>;
	readonly projection: Projection<TData, TUi>;
	readonly revision: number;
	readonly lifecycle: number;
	readonly controller: AbortController;
	finished?: boolean;
	timer?: ReturnType<typeof setTimeout> | undefined;
}

export interface ScopedAsyncDeps<TData, TUi> {
	readonly form: () => FormApi<TData, TUi>;
	readonly revision: () => number;
	readonly updateState: (updater: (state: FormState<TData, TUi>) => FormState<TData, TUi>) => void;
	readonly timeout?: number;
}

export interface ScopedForeground {
	readonly paths: readonly AbsoluteDataPath[];
	run(): Promise<readonly ValidationIssue[]>;
	previous(): ReadonlySet<ValidationIssue>;
	commit(): void;
}

function scopeSegments(scope: DataPathInput | undefined): readonly CanonicalSegment[] | undefined {
	if (scope === undefined) return undefined;
	normalizeDataPath(scope);
	return typeof scope === "string"
		? parsePath(scope).segments
		: Array.isArray(scope)
			? scope
			: (scope as AbsoluteDataPath).segments;
}

function overlaps(a: readonly CanonicalSegment[], b: readonly CanonicalSegment[]): boolean {
	const length = Math.min(a.length, b.length);
	for (let index = 0; index < length; index++) if (a[index] !== b[index]) return false;
	return true;
}

function keyOf(field: ScopedAsyncField): string {
	return JSON.stringify([field.id, field.instanceKey]);
}

function failure(field: ScopedAsyncField, error: unknown): ValidationIssue {
	return {
		code: "ASYNC_VALIDATOR_EXCEPTION",
		message: error instanceof Error ? error.message : String(error),
		severity: "error",
		path: field.binding,
		source: { origin: "async-validator", validatorId: field.id },
	};
}

export class ScopedAsyncScheduler<TData, TUi> {
	private readonly pending = new Map<string, Pending<TData, TUi>>();
	private readonly emitted = new Map<string, readonly ValidationIssue[]>();
	private lifecycle = 0;
	private foregroundGeneration = 0;
	private disposed = false;

	constructor(private readonly deps: ScopedAsyncDeps<TData, TUi>) {}

	hasHost(): boolean {
		return scopedAsyncHost(this.deps.form()) !== undefined;
	}

	private project(): { capture: Capture<TData, TUi>; projection: Projection<TData, TUi> } | undefined {
		const form = this.deps.form();
		const host = scopedAsyncHost(form);
		if (!host) return undefined;
		const capture = form.captureState();
		const projection = host.instances(form, capture);
		if (!projection.current()) throw new Error("Stale scoped async projection");
		return { capture, projection };
	}

	private current(token: Pending<TData, TUi>): boolean {
		return (
			!this.disposed &&
			this.lifecycle === token.lifecycle &&
			this.deps.revision() === token.revision &&
			this.pending.get(token.key) === token &&
			!token.controller.signal.aborted
		);
	}

	private cancel(token: Pending<TData, TUi>): void {
		if (token.timer) clearTimeout(token.timer);
		token.controller.abort();
		if (this.pending.get(token.key) === token) this.pending.delete(token.key);
	}

	private publish(key: string, issues: readonly ValidationIssue[]): void {
		const owned = this.emitted.get(key);
		const previous = new Set(owned ?? []);
		// Subscribers run during commit; reentrant events must see the ownership being published.
		this.emitted.set(key, issues);
		try {
			this.deps.updateState((state) => ({
				...state,
				issues: normalizeIssues([...state.issues.filter((issue) => !previous.has(issue)), ...issues]),
			}));
		} catch (error) {
			if (this.emitted.get(key) === issues) {
				if (owned === undefined) this.emitted.delete(key);
				else this.emitted.set(key, owned);
			}
			throw error;
		}
	}

	private projectionFor(token: Pending<TData, TUi>): AsyncProjection<TData, TUi> {
		return {
			form: this.deps.form(),
			capture: token.capture,
			fields: token.projection.fields,
			projectionCurrent: () => this.current(token) && token.projection.current(),
			revision: token.revision,
			currentRevision: this.deps.revision,
			signal: token.controller.signal,
		};
	}

	private async execute(token: Pending<TData, TUi>): Promise<void> {
		let issues: readonly ValidationIssue[];
		const timeout = this.deps.timeout ?? DEFAULT_RUNTIME_CONSTRAINTS.validatorTimeout;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;
		try {
			issues = await Promise.race([
				runScopedAsyncField(token.field, this.projectionFor(token)),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => {
							timedOut = true;
							reject(new Error("Scoped async validator timed out"));
						},
						Math.max(0, timeout),
					);
				}),
			]);
		} catch (error) {
			issues = [failure(token.field, error)];
		} finally {
			if (timer) clearTimeout(timer);
		}
		if (!this.current(token) || !token.projection.current()) return;
		try {
			this.publish(token.key, issues);
		} catch {
			this.cancel(token);
			return;
		}
		if (timedOut) token.controller.abort();
		if (this.current(token)) token.finished = true;
	}

	private schedule(field: ScopedAsyncField, capture: Capture<TData, TUi>, projection: Projection<TData, TUi>): void {
		const key = keyOf(field);
		const old = this.pending.get(key);
		if (old) this.cancel(old);
		const token: Pending<TData, TUi> = {
			key,
			field,
			capture,
			projection,
			revision: this.deps.revision(),
			lifecycle: this.lifecycle,
			controller: new AbortController(),
		};
		this.pending.set(key, token);
		token.timer = setTimeout(() => {
			token.timer = undefined;
			if (this.current(token)) void this.execute(token);
		}, field.debounceMs);
	}

	onEvent(path: AbsoluteDataPath | undefined, trigger: Trigger): void {
		if (this.disposed) return;
		this.foregroundGeneration += 1;
		const previous = [...this.pending.values()].filter((token) => !token.finished);
		if (trigger === "onChange") for (const token of [...this.pending.values()]) this.cancel(token);
		const resolved = this.project();
		if (!resolved) return;
		const present = new Set(resolved.projection.fields.map(keyOf));
		for (const key of this.emitted.keys()) if (!present.has(key)) this.publish(key, []);
		if (trigger === "onChange") {
			for (const token of previous) {
				if (present.has(token.key) && this.emitted.get(token.key)?.length) this.publish(token.key, []);
			}
		}
		for (const field of resolved.projection.fields) {
			const selected = path && trigger === field.trigger && overlaps(field.binding.segments, path.segments);
			if (selected || (trigger === "onChange" && previous.some((token) => token.key === keyOf(field))))
				this.schedule(field, resolved.capture, resolved.projection);
		}
	}

	prepareForeground(scope: DataPathInput | undefined, signal: AbortSignal): ScopedForeground | undefined {
		const resolved = this.project();
		if (!resolved) return undefined;
		const segments = scopeSegments(scope);
		const fields = resolved.projection.fields.filter(
			(field) => segments === undefined || overlaps(field.binding.segments, segments),
		);
		const keys = new Set(fields.map(keyOf));
		if (segments === undefined) for (const key of this.emitted.keys()) keys.add(key);
		else
			for (const [key, issues] of this.emitted) {
				if (issues.some((issue) => overlaps(issue.path.segments, segments))) keys.add(key);
			}
		for (const key of keys) {
			const token = this.pending.get(key);
			if (token) this.cancel(token);
		}
		const generation = ++this.foregroundGeneration;
		const revision = this.deps.revision();
		const current = () => !this.disposed && this.foregroundGeneration === generation && !signal.aborted;
		const results = new Map<string, readonly ValidationIssue[]>();
		const run = async () => {
			await Promise.all(
				fields.map(async (field) => {
					const issues = await runScopedAsyncField(field, {
						form: this.deps.form(),
						capture: resolved.capture,
						fields,
						projectionCurrent: () => current() && resolved.projection.current(),
						revision,
						currentRevision: this.deps.revision,
						signal,
					});
					results.set(keyOf(field), issues);
				}),
			);
			if (!current() || !resolved.projection.current()) throw new Error("Stale scoped async foreground");
			return [...results.values()].flat();
		};
		return {
			paths: fields.map((field) => field.binding),
			run,
			previous: () => new Set([...keys].flatMap((key) => this.emitted.get(key) ?? [])),
			commit: () => {
				for (const key of keys) this.emitted.set(key, results.get(key) ?? []);
			},
		};
	}

	reset(dispose = false): void {
		this.lifecycle += 1;
		this.foregroundGeneration += 1;
		if (dispose) this.disposed = true;
		for (const token of [...this.pending.values()]) this.cancel(token);
		this.emitted.clear();
	}
}
