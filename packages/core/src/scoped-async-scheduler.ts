import type { FormApi } from "./contracts.js";
import { type AbsoluteDataPath, type DataPathInput, normalizeDataPath } from "./field-policy.js";
import { parsePath } from "./path-parser.js";
import type { CanonicalSegment } from "./path.js";
import { type AsyncProjection, runScopedAsyncField } from "./scoped-async-execution.js";
import { runScopedForeground, selectForegroundKeys } from "./scoped-async-foreground-run.js";
import {
	type Observation,
	type ObservationContext,
	observationContext,
	observationCurrent,
	observe,
} from "./scoped-async-observation.js";
import { type ScopedAsyncField, scopedAsyncHost } from "./scoped-async.js";
import { scopedCaptureReceipt } from "./scoped-capture-receipt.js";
import type { FormStateCapture, ValidationIssue } from "./state.js";
import { snapshotOwnership } from "./store.js";
import { DEFAULT_RUNTIME_CONSTRAINTS } from "./timeout.js";

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
	readonly observationContext: ObservationContext;
	readonly deadline: number;
	finished?: boolean;
	timer?: ReturnType<typeof setTimeout> | undefined;
}

export interface ScopedAsyncDeps<TData, TUi> {
	readonly form: () => FormApi<TData, TUi>;
	readonly revision: () => number;
	readonly publishIssues: (previous: ReadonlySet<ValidationIssue>, issues: readonly ValidationIssue[]) => void;
	readonly timeout?: number;
}

export interface ScopedForeground {
	readonly paths: readonly AbsoluteDataPath[];
	run(): Promise<readonly ValidationIssue[]>;
	stage(): { readonly previous: ReadonlySet<ValidationIssue>; finish(): void; rollback(): void };
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
	private readonly observations = new Map<string, Observation>();
	private readonly publishing = new Set<string>();
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

	private publish(key: string, issues: readonly ValidationIssue[], observation?: Observation): void {
		const owned = this.emitted.get(key);
		const priorObservation = this.observations.get(key);
		const previous = new Set(owned ?? []);
		// Subscribers run synchronously; reentry must see the ownership being published.
		this.emitted.set(key, issues);
		if (observation && issues.length) this.observations.set(key, observation);
		else this.observations.delete(key);
		try {
			this.deps.publishIssues(previous, issues);
		} catch (error) {
			if (this.emitted.get(key) === issues) {
				if (owned === undefined) this.emitted.delete(key);
				else this.emitted.set(key, owned);
				if (priorObservation) this.observations.set(key, priorObservation);
				else this.observations.delete(key);
			}
			throw error;
		}
	}

	private revoke(keys: ReadonlySet<string>): void {
		const old = new Map<
			string,
			{ issues: readonly ValidationIssue[]; observation: Observation | undefined; empty: readonly ValidationIssue[] }
		>();
		const previous = new Set<ValidationIssue>();
		for (const key of keys) {
			const issues = this.emitted.get(key);
			if (!issues?.length) continue;
			const empty: readonly ValidationIssue[] = [];
			old.set(key, { issues, observation: this.observations.get(key), empty });
			for (const issue of issues) previous.add(issue);
			this.emitted.set(key, empty);
			this.observations.delete(key);
		}
		if (!old.size) return;
		try {
			this.deps.publishIssues(previous, []);
		} catch (error) {
			for (const [key, prior] of old) {
				if (this.emitted.get(key) !== prior.empty) continue;
				this.emitted.set(key, prior.issues);
				if (prior.observation) this.observations.set(key, prior.observation);
			}
			throw error;
		}
	}

	private projectionFor(token: Pending<TData, TUi>): AsyncProjection<TData, TUi> {
		return {
			form: this.deps.form(),
			capture: token.capture,
			projectionCurrent: () => this.current(token) && token.projection.current(),
			revision: token.revision,
			currentRevision: this.deps.revision,
			signal: token.controller.signal,
			receipt: scopedCaptureReceipt(token.capture),
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
			this.publish(token.key, issues, observe(token.field, token.capture.state.data, token.observationContext));
		} catch {
			this.cancel(token);
			return;
		}
		if (timedOut) token.controller.abort();
		if (this.current(token)) token.finished = true;
	}

	private schedule(
		field: ScopedAsyncField,
		capture: Capture<TData, TUi>,
		projection: Projection<TData, TUi>,
		context: ObservationContext,
		deadline = Date.now() + field.debounceMs,
	): void {
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
			observationContext: context,
			deadline,
		};
		this.pending.set(key, token);
		token.timer = setTimeout(
			() => {
				token.timer = undefined;
				if (this.current(token)) void this.execute(token);
			},
			Math.max(0, deadline - Date.now()),
		);
	}

	onEvent(path: AbsoluteDataPath | undefined, trigger: Trigger): void {
		if (this.disposed) return;
		const generation = ++this.foregroundGeneration;
		const revoked = new Set(this.publishing);
		this.publishing.clear();
		const previous = [...this.pending.values()].filter((token) => !token.finished);
		const pendingDeadlines = new Map(previous.map((token) => [token.key, token.deadline] as const));
		if (trigger === "onChange") for (const token of [...this.pending.values()]) this.cancel(token);
		const resolved = this.project();
		if (!resolved) {
			this.revoke(revoked);
			return;
		}
		const present = new Set(resolved.projection.fields.map(keyOf));
		const compared = new Map<object, boolean>();
		for (const key of this.emitted.keys()) {
			if (!present.has(key) || !observationCurrent(this.observations.get(key), resolved.capture.state.data, compared))
				revoked.add(key);
		}
		if (trigger === "onChange") {
			for (const token of previous) {
				if (present.has(token.key) && this.emitted.get(token.key)?.length) revoked.add(token.key);
			}
		}
		this.revoke(revoked);
		if (this.disposed || this.foregroundGeneration !== generation) return;
		const context = observationContext(snapshotOwnership(resolved.capture.state)?.owned);
		for (const field of resolved.projection.fields) {
			const selected = path && trigger === field.trigger && overlaps(field.binding.segments, path.segments);
			if (selected || (trigger === "onChange" && pendingDeadlines.has(keyOf(field))))
				this.schedule(
					field,
					resolved.capture,
					resolved.projection,
					context,
					selected ? Date.now() + field.debounceMs : pendingDeadlines.get(keyOf(field)),
				);
		}
	}

	prepareForeground(
		scope: DataPathInput | undefined,
		signal: AbortSignal,
		snapshot?: { readonly data: TData; readonly uiState: TUi },
	): ScopedForeground | undefined {
		const resolved = this.project();
		if (!resolved) return undefined;
		if (
			snapshot &&
			(resolved.capture.state.data !== snapshot.data || resolved.capture.state.uiState !== snapshot.uiState)
		)
			throw new Error("Scoped async capture differs from retained validation snapshot");
		const segments = scopeSegments(scope);
		const fields = resolved.projection.fields.filter(
			(field) => segments === undefined || overlaps(field.binding.segments, segments),
		);
		const keys = selectForegroundKeys(fields, this.emitted, segments);
		for (const key of keys) {
			const token = this.pending.get(key);
			if (token) this.cancel(token);
		}
		const generation = ++this.foregroundGeneration;
		const revision = this.deps.revision();
		const receipt = scopedCaptureReceipt(resolved.capture);
		const current = () => !this.disposed && this.foregroundGeneration === generation && !signal.aborted;
		const results = new Map<string, readonly ValidationIssue[]>();
		const run = () =>
			runScopedForeground(
				fields,
				{
					form: this.deps.form(),
					capture: resolved.capture,
					projectionCurrent: () => current() && resolved.projection.current(),
					revision,
					currentRevision: this.deps.revision,
					signal,
					receipt,
				},
				results,
			);
		return {
			paths: fields.map((field) => field.binding),
			run,
			stage: () => {
				if (!current() || !resolved.projection.current() || !receipt(this.deps.form().getState()))
					throw new Error("Stale scoped async foreground publication");
				return this.stageForeground(keys, fields, results, resolved.capture);
			},
		};
	}

	private stageForeground(
		keys: ReadonlySet<string>,
		fields: readonly ScopedAsyncField[],
		results: ReadonlyMap<string, readonly ValidationIssue[]>,
		capture: Capture<TData, TUi>,
	): ReturnType<ScopedForeground["stage"]> {
		const context = observationContext(snapshotOwnership(capture.state)?.owned);
		const old = new Map([...keys].map((key) => [key, this.emitted.get(key)] as const));
		const oldObservations = new Map([...keys].map((key) => [key, this.observations.get(key)] as const));
		const previous = new Set([...old.values()].flatMap((issues) => issues ?? []));
		const staged = new Map([...keys].map((key) => [key, results.get(key) ?? []] as const));
		const fieldsByKey = new Map(fields.map((field) => [keyOf(field), field] as const));
		for (const [key, issues] of staged) {
			this.emitted.set(key, issues);
			const field = fieldsByKey.get(key);
			if (field && issues.length) this.observations.set(key, observe(field, capture.state.data, context));
			else this.observations.delete(key);
			this.publishing.add(key);
		}
		return {
			previous,
			finish: () => {
				for (const key of keys) this.publishing.delete(key);
			},
			rollback: () => {
				for (const key of keys) this.publishing.delete(key);
				for (const [key, issues] of staged) {
					if (this.emitted.get(key) !== issues) continue;
					const prior = old.get(key);
					if (prior === undefined) this.emitted.delete(key);
					else this.emitted.set(key, prior);
					const observation = oldObservations.get(key);
					if (observation) this.observations.set(key, observation);
					else this.observations.delete(key);
				}
			},
		};
	}

	reset(dispose = false): void {
		this.lifecycle += 1;
		this.foregroundGeneration += 1;
		if (dispose) this.disposed = true;
		for (const token of [...this.pending.values()]) this.cancel(token);
		this.emitted.clear();
		this.observations.clear();
		this.publishing.clear();
	}
}
