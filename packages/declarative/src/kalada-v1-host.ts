import type { JsonValue } from "@formbar/expressions";
import type { ArrayActionHost407, TrustedAction407 } from "./validators/kalada-action-contract-407.js";
import type {
	LifecycleStatus,
	SchemaDefaultV1,
	SchemaValidatorV1,
	ScopedValidatorV1,
	SubmissionResult,
} from "./validators/kalada-data-strategy.js";
import { captureInitialization } from "./validators/kalada-initialization-data.js";
import type { PrepareKaladaV1Options, PreparedKaladaV1Definition } from "./validators/kalada-prepared-definition.js";
import { prepareKaladaV1Definition } from "./validators/kalada-prepared-definition.js";
import { createPreparedKaladaV1Runtime } from "./validators/kalada-prepared-runtime.js";
import type {
	PreparedControl,
	PreparedNodeView,
	PreparedOutput,
	PreparedRowView,
} from "./validators/kalada-prepared-view.js";

export type {
	PreparedControl as KaladaV1Control,
	PreparedOutput as KaladaV1Output,
	PreparedRowView as KaladaV1RowView,
} from "./validators/kalada-prepared-view.js";

export interface CreateKaladaV1HostOptions extends PrepareKaladaV1Options {
	readonly installed?: {
		readonly widgets?: ReadonlySet<string>;
		readonly renderers?: ReadonlySet<string>;
		readonly arrayHost?: ArrayActionHost407;
		readonly actions?: Readonly<Record<string, TrustedAction407>>;
	};
	readonly initialization?: { readonly defaults: readonly SchemaDefaultV1[]; readonly overrides?: JsonValue };
	readonly validators?: readonly SchemaValidatorV1[];
	readonly scopedValidators?: readonly ScopedValidatorV1[];
}

export interface KaladaV1Snapshot {
	readonly revision: object;
	readonly data: JsonValue;
	readonly controls: readonly PreparedControl[];
	readonly outputs: readonly PreparedOutput[];
	readonly rows: readonly PreparedRowView[];
	readonly tree: PreparedNodeView;
	readonly lifecycle?: LifecycleStatus;
	readonly initial?: JsonValue;
}

export interface KaladaV1Host {
	readonly definition: JsonValue;
	currentRevision(): object | undefined;
	snapshot(): KaladaV1Snapshot;
	subscribe(invalidate: () => void): () => void;
	submit(): Promise<SubmissionResult>;
	validate(): Promise<{ readonly ok: boolean; readonly code?: string }>;
	reset(): { readonly ok: boolean; readonly code?: string };
	dispose(): void;
}

function installScoped(prepared: PreparedKaladaV1Definition, entries: readonly ScopedValidatorV1[]) {
	if (!entries.length) return;
	if (
		!prepared.strategy.captureLifecycle ||
		!prepared.strategy.installScopedValidation ||
		!prepared.strategy.notifyScopedValidation ||
		!prepared.strategy.cancelScopedValidation
	)
		throw new TypeError("Scoped lifecycle strategy required.");
	const ids = new Set<string>();
	for (const entry of entries) {
		const field = [...prepared.admitted.nodes.values()].find((node) => node.path === entry.field);
		if (
			!field ||
			!["field", "custom"].includes(field.type) ||
			!entry.id?.trim() ||
			ids.has(entry.id) ||
			!["onChange", "onBlur"].includes(entry.trigger) ||
			typeof entry.validate !== "function" ||
			(entry.debounceMs !== undefined && (!Number.isSafeInteger(entry.debounceMs) || entry.debounceMs < 0))
		)
			throw new TypeError("Invalid scoped validator registration.");
		ids.add(entry.id);
	}
	if (prepared.strategy.installScopedValidation(prepared.context, entries).status !== "installed")
		throw new TypeError("Scoped validation installation denied.");
}

/** Candidate-only host boundary; public V1 validator and FormRenderer switch together in Batch 4. */
export function createKaladaV1Host(options: CreateKaladaV1HostOptions): KaladaV1Host {
	const initialization = captureInitialization(options);
	const prepared = prepareKaladaV1Definition(options);
	if (initialization) {
		const revision = prepared.strategy.current(prepared.context);
		if (!prepared.strategy.initializeSchema || !revision)
			throw new TypeError("Schema initialization strategy required.");
		const result = prepared.strategy.initializeSchema(prepared.context, {
			contract: "formbar-schema-initialization-v1",
			instance: prepared.context.instance,
			revision,
			...initialization,
		});
		if (result.status !== "applied" || result.revision !== prepared.strategy.current(prepared.context))
			throw new TypeError("Schema initialization denied or stale.");
	}
	if (options.validators?.length) {
		if (
			!prepared.strategy.captureLifecycle ||
			!prepared.strategy.validateLifecycle ||
			!prepared.strategy.installSchemaValidation
		)
			throw new TypeError("Schema validation lifecycle strategy required.");
		if (prepared.strategy.installSchemaValidation(prepared.context, options.validators).status !== "installed")
			throw new TypeError("Schema validation installation denied.");
	}
	installScoped(prepared, options.scopedValidators ?? []);
	const runtime = createPreparedKaladaV1Runtime(prepared, options.installed, !!options.scopedValidators?.length);
	return Object.freeze({
		definition: prepared.definition,
		snapshot: runtime.snapshot,
		subscribe: runtime.subscribe,
		currentRevision: runtime.currentRevision,
		submit: runtime.submit,
		validate: runtime.validate,
		reset: runtime.reset,
		dispose: runtime.dispose,
	});
}
