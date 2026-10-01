import type { CreateKaladaV1HostOptions, JsonValue } from "@formbar/declarative";
import { DemoFieldState, type Field } from "./kalada-demo-field-state";
import { type Row, clone, empty, key } from "./kalada-demo-state";

export type Strategy = CreateKaladaV1HostOptions["strategy"];
export type Context = Parameters<Strategy["capture"]>[0];
export type Reference = Parameters<ReturnType<Strategy["capture"]>["read"]>[0];
export type Scope = Parameters<ReturnType<Strategy["capture"]>["read"]>[1];
export type Path = readonly (string | number)[];
export type Issue = { readonly path: Path; readonly message: string; readonly source: "schema" | "extension" };
export type Validators = readonly ((
	data: JsonValue,
	signal: AbortSignal,
) => readonly Issue[] | Promise<readonly Issue[]>)[];
export type OwnedIssue = Issue & {
	readonly validator: Validators[number];
	readonly origin: object;
	readonly ordinal: number;
};
export type ValidationRun = { readonly controller: AbortController };
export type ScopedRun = ValidationRun & {
	readonly field: Field;
	readonly fieldKey: string;
	timer?: ReturnType<typeof setTimeout>;
};

/** Positions locate data only after session-owned lexical row tokens have been resolved. */
export class DemoStore {
	data: JsonValue = {};
	initial: JsonValue = {};
	revision: object = {};
	status = empty();
	validators: Validators = [];
	validatorOrigins: readonly object[] = [];
	schemaOrigin: object | undefined;
	controller = new AbortController();
	validation: ValidationRun | undefined;
	issueRecords: readonly OwnedIssue[] = [];
	scopedValidators: Parameters<NonNullable<Strategy["installScopedValidation"]>>[1] = [];
	readonly scopedRuns = new Map<string, ScopedRun>();
	readonly scopedIssues = new Map<string, { fieldKey: string; issues: readonly Issue[] }>();
	readonly subscribers = new Set<() => void>();
	readonly rows = new Map<string, Row[]>();
	readonly fields = new DemoFieldState();

	get(path: Path): JsonValue | undefined {
		let value: JsonValue | undefined = this.data;
		for (const part of path) {
			if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return;
			value = (value as Record<string | number, JsonValue>)[part];
		}
		return value;
	}

	put(path: Path, value: JsonValue) {
		let cursor = this.data as Record<string | number, JsonValue>;
		for (const part of path.slice(0, -1)) {
			if (cursor[part] === undefined) cursor[part] = {};
			cursor = cursor[part] as Record<string | number, JsonValue>;
		}
		cursor[path[path.length - 1] as string] = clone(value);
	}

	locate(ref: Reference, scope: Scope): (string | number)[] | undefined {
		const result: (string | number)[] = [];
		let ordinal = 0;
		for (const part of ref.path) {
			if (typeof part === "string") {
				result.push(part);
				continue;
			}
			if (typeof part !== "object") return;
			const binding = scope.rows[ordinal++];
			if (binding?.name !== part.row) return;
			const index = this.rows.get(key(result))?.findIndex((entry) => entry.token === binding.token);
			if (index === undefined || index < 0) return;
			result.push(index);
		}
		return ordinal === scope.rows.length ? result : undefined;
	}

	rowsAt(path: Path) {
		const value = this.get(path);
		if (!Array.isArray(value)) return;
		if (!this.rows.has(key(path)))
			this.rows.set(
				key(path),
				value.map((item) => ({ token: {}, revision: {}, value: item })),
			);
		return this.rows.get(key(path));
	}

	invalidate() {
		this.controller.abort();
		this.controller = new AbortController();
		this.validation?.controller.abort();
		this.validation = undefined;
		for (const run of this.scopedRuns.values()) {
			run.controller.abort();
			clearTimeout(run.timer);
		}
		this.scopedRuns.clear();
		this.syncStatus();
	}
	notify() {
		for (const listener of this.subscribers) listener();
	}
	changed(touched = false) {
		this.invalidate();
		this.issueRecords = [];
		this.scopedIssues.clear();
		this.syncStatus();
		this.status.dirty = true;
		this.status.touched ||= touched;
		this.status.submitted = false;
	}

	beginValidation(): ValidationRun {
		this.validation?.controller.abort();
		const run = { controller: new AbortController() };
		this.validation = run;
		this.syncStatus();
		this.notify();
		return run;
	}
	finishValidation(run: ValidationRun) {
		if (this.validation !== run) return false;
		this.validation = undefined;
		this.syncStatus();
		return true;
	}
	applyIssues(issues: readonly OwnedIssue[]) {
		this.issueRecords = Object.freeze([...issues]);
		this.syncStatus();
	}
	syncStatus() {
		const issues = [...this.issueRecords, ...[...this.scopedIssues.values()].flatMap((entry) => entry.issues)];
		this.status.issues = {
			schema: issues.filter((issue) => issue.source === "schema").map((issue) => issue.message),
			extension: issues.filter((issue) => issue.source === "extension").map((issue) => issue.message),
		};
		this.status.valid = issues.length === 0;
		this.status.validating = this.validation !== undefined || this.scopedRuns.size > 0;
	}
	retireFields() {
		const tokens = new Set([...this.rows.values()].flatMap((rows) => rows.map((row) => row.token)));
		this.fields.retire(tokens);
	}
}
