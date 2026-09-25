import type { FormApi } from "./contracts.js";
import { createIssueEmission } from "./issue-provenance.js";
import type { CanonicalSegment } from "./path.js";
import type { FormStateCapture, IssueSeverity, ValidationIssue } from "./state.js";

export interface ScopedFieldIssueInput {
	readonly code: string;
	readonly message: string;
	readonly severity: IssueSeverity;
	readonly descendant?: readonly CanonicalSegment[];
}

export interface ScopedFieldInstance {
	readonly fieldId: string;
	readonly instanceKey: string;
	readonly binding: { readonly namespace: "data"; readonly segments: readonly CanonicalSegment[] };
	readonly validate: () => readonly ScopedFieldIssueInput[];
}

/** Trusted definition host; only prepared definition adapters should register. */
export interface ScopedSyncHost<TData, TUi> {
	instances(
		form: FormApi<TData, TUi>,
		capture: FormStateCapture<TData, TUi>,
		stage?: string,
	): {
		readonly current: () => boolean;
		readonly fields: readonly ScopedFieldInstance[];
	};
}

const hosts = new WeakMap<object, ScopedSyncHost<never, never>>();
const generations = new WeakMap<object, number>();

export function registerScopedSync<TData, TUi>(form: FormApi<TData, TUi>, host: ScopedSyncHost<TData, TUi>): void {
	if (hosts.has(form) || form.isDisposed()) throw new TypeError("Scoped sync host already registered or form disposed");
	hosts.set(form, host as unknown as ScopedSyncHost<never, never>);
}

/** React deactivation revokes all emissions without needing a state write. */
export function invalidateScopedSync(form: object): void {
	if (hosts.has(form)) generations.set(form, (generations.get(form) ?? 0) + 1);
}

function valueAt(root: unknown, segments: readonly CanonicalSegment[]): boolean {
	let value = root;
	for (const segment of segments) {
		if (value === null || typeof value !== "object") return false;
		if (Array.isArray(value) !== (typeof segment === "number")) return false;
		if (typeof segment === "number" && (!Number.isSafeInteger(segment) || segment < 0)) return false;
		if (typeof segment === "string" && (!segment || ["__proto__", "prototype", "constructor"].includes(segment)))
			return false;
		if (!Object.hasOwn(value, segment)) return false;
		value = (value as Record<string | number, unknown>)[segment];
	}
	return value !== undefined;
}

function diagnostic(input: ScopedFieldIssueInput): boolean {
	if (!input || typeof input !== "object") return false;
	const keys = Object.keys(input);
	return (
		keys.every((key) => ["code", "message", "severity", "descendant"].includes(key)) &&
		typeof input.code === "string" &&
		!!input.code &&
		typeof input.message === "string" &&
		["error", "warning", "info"].includes(input.severity) &&
		(input.descendant === undefined || (Array.isArray(input.descendant) && input.descendant.length > 0))
	);
}

/** Called only by the core form's full-draft synchronous validation entry. */
export function runScopedSync<TData, TUi>(form: FormApi<TData, TUi>, stage?: string): readonly ValidationIssue[] {
	const host = hosts.get(form) as unknown as ScopedSyncHost<TData, TUi> | undefined;
	if (!host) return [];
	const capture = form.captureState();
	const generation = (generations.get(form) ?? 0) + 1;
	generations.set(form, generation);
	const projection = host.instances(form, capture, stage);
	const current = () =>
		generations.get(form) === generation &&
		!form.isDisposed() &&
		form.captureState().state === capture.state &&
		projection.current();
	if (!current()) throw new Error("Stale scoped sync projection");
	const run = {};
	const issues: ValidationIssue[] = [];
	for (const field of projection.fields) {
		if (
			!current() ||
			field.binding.namespace !== "data" ||
			!field.binding.segments.length ||
			!valueAt(capture.state.data, field.binding.segments)
		)
			throw new Error("Invalid scoped field binding");
		const proposed = field.validate();
		if (!Array.isArray(proposed) || !current()) throw new Error("Invalid scoped field result");
		const emit = createIssueEmission({
			fieldId: field.fieldId,
			instanceKey: field.instanceKey,
			binding: field.binding,
			revision: generation,
			run,
			current,
		});
		for (const input of proposed) {
			if (!diagnostic(input) || !valueAt(capture.state.data, [...field.binding.segments, ...(input.descendant ?? [])]))
				throw new Error("Invalid scoped field issue");
			issues.push(
				emit({
					code: input.code,
					message: input.message,
					severity: input.severity,
					...(stage === undefined ? {} : { stage }),
					...(input.descendant ? { descendant: input.descendant } : {}),
				}),
			);
		}
	}
	return issues;
}
