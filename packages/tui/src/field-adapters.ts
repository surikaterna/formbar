import type { FormbarOption, SchemaFieldInfo } from "@formbar/from-schema";
import type { TuiDiagnostic } from "./contracts.js";

export type TuiPrimitive = string | number | boolean | null;
export type TuiFieldMode = "text" | "boolean" | "select";

export type TuiCodecResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly code: string; readonly message?: string };

export interface TuiFieldAdapterContext {
	readonly field: SchemaFieldInfo;
	readonly options: readonly FormbarOption[];
}

export interface TuiFieldCodec {
	readonly mode: TuiFieldMode;
	readonly masked?: boolean;
	readonly options?: readonly FormbarOption[];
	toDraft(value: unknown): TuiCodecResult<string | boolean>;
	acceptsDraft(draft: string): boolean;
	fromDraft(draft: string): TuiCodecResult<TuiPrimitive>;
}

export interface TuiFieldAdapter {
	readonly id: string;
	matches(context: TuiFieldAdapterContext): boolean;
	create(context: TuiFieldAdapterContext): TuiFieldCodec;
}

export type TuiAdapterRegistryMode = "extend" | "replace";

export interface TuiFieldAdapterResolution {
	readonly adapterId?: string;
	readonly codec?: TuiFieldCodec;
	readonly diagnostics: readonly TuiDiagnostic[];
}

export interface TuiFieldAdapterRegistry {
	readonly mode: TuiAdapterRegistryMode;
	snapshot(): readonly TuiFieldAdapter[];
	resolve(context: TuiFieldAdapterContext): TuiFieldAdapterResolution;
	extend(adapters: readonly TuiFieldAdapter[]): TuiFieldAdapterRegistry;
	replace(adapters: readonly TuiFieldAdapter[]): TuiFieldAdapterRegistry;
}

const failure = (message: string, path: string): TuiFieldAdapterResolution => ({
	diagnostics: [{ code: "unsupported-field", severity: "error", message, path }],
});

const invalid = <T>(): TuiCodecResult<T> => ({ ok: false, code: "invalid-value", message: "Invalid value" });
const valid = <T>(value: T): TuiCodecResult<T> => ({ ok: true, value });
const metadata = (context: TuiFieldAdapterContext) => context.field.metadata as Record<string, unknown> | undefined;

const maskedCodec: TuiFieldCodec = Object.freeze({
	mode: "text",
	masked: true,
	toDraft: () => valid<string>(""),
	acceptsDraft: () => true,
	fromDraft: (draft: string) => valid<string>(draft),
});

const maskedAdapter: TuiFieldAdapter = Object.freeze({
	id: "masked-text",
	matches: ({ field }: TuiFieldAdapterContext) =>
		field.metadata?.writeOnly === true || field.metadata?.widget === "password",
	create: () => maskedCodec,
});

const selectAdapter: TuiFieldAdapter = Object.freeze({
	id: "static-primitive-select",
	matches: (context: TuiFieldAdapterContext) =>
		context.options.length > 0 && isBuiltInPrimitiveType(context.field.type) && plainMetadata(context),
	create: ({ options }: TuiFieldAdapterContext) => {
		const copy = Object.freeze(options.map((option: FormbarOption) => Object.freeze({ ...option })));
		return Object.freeze({
			mode: "select" as const,
			options: copy,
			toDraft(value: unknown) {
				return copy.some((option) => Object.is(option.value, value)) ? valid<string>("") : invalid<string | boolean>();
			},
			acceptsDraft: () => true,
			fromDraft: () => invalid<TuiPrimitive>(),
		});
	},
});

function textCodec(): TuiFieldCodec {
	return Object.freeze({
		mode: "text" as const,
		toDraft: (value: unknown) => (typeof value === "string" ? valid<string>(value) : invalid<string | boolean>()),
		acceptsDraft: () => true,
		fromDraft: (draft: string) => valid<string>(draft),
	});
}

function numericCodec(integer: boolean, bounds: Record<string, unknown> | undefined): TuiFieldCodec {
	return Object.freeze({
		mode: "text" as const,
		toDraft(value: unknown) {
			if (typeof value !== "number" || !Number.isFinite(value)) return invalid<string | boolean>();
			if (integer && !Number.isSafeInteger(value)) return invalid<string | boolean>();
			if (!withinBounds(value, bounds)) return invalid<string | boolean>();
			return valid<string>(String(value));
		},
		acceptsDraft: (draft: string) => possibleNumber(draft, integer),
		fromDraft(draft: string) {
			if (!completeNumber(draft, integer)) return invalid<TuiPrimitive>();
			const value = Number(draft);
			if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value))) return invalid<TuiPrimitive>();
			return withinBounds(value, bounds) ? valid<number>(value) : invalid<TuiPrimitive>();
		},
	});
}

const builtins: readonly TuiFieldAdapter[] = Object.freeze([
	selectAdapter,
	Object.freeze({
		id: "safe-string",
		matches: (context: TuiFieldAdapterContext) => context.field.type === "string" && plainMetadata(context),
		create: textCodec,
	}),
	Object.freeze({
		id: "safe-integer",
		matches: (context: TuiFieldAdapterContext) => context.field.type === "integer" && plainMetadata(context),
		create: (context: TuiFieldAdapterContext) => numericCodec(true, metadata(context)),
	}),
	Object.freeze({
		id: "safe-number",
		matches: (context: TuiFieldAdapterContext) => context.field.type === "number" && plainMetadata(context),
		create: (context: TuiFieldAdapterContext) => numericCodec(false, metadata(context)),
	}),
	Object.freeze({
		id: "safe-boolean",
		matches: (context: TuiFieldAdapterContext) => context.field.type === "boolean" && plainMetadata(context),
		create: () =>
			Object.freeze({
				mode: "boolean" as const,
				toDraft: (value: unknown) => (typeof value === "boolean" ? valid<boolean>(value) : invalid<string | boolean>()),
				acceptsDraft: () => false,
				fromDraft: () => invalid<TuiPrimitive>(),
			}),
	}),
]);

export function createTuiFieldAdapterRegistry(
	adapters: readonly TuiFieldAdapter[] = [],
	mode: TuiAdapterRegistryMode = "extend",
): TuiFieldAdapterRegistry {
	validateAdapters(adapters, mode === "extend" ? builtins : []);
	const captured = adapters.map(captureAdapter);
	const selected = Object.freeze([
		...(mode === "extend" ? captured : []),
		...(mode === "extend" ? builtins : captured),
	]);
	return registry(selected, mode);
}

function registry(adapters: readonly TuiFieldAdapter[], mode: TuiAdapterRegistryMode): TuiFieldAdapterRegistry {
	return Object.freeze({
		mode,
		snapshot: () => adapters,
		resolve: (context: TuiFieldAdapterContext) => resolve(adapters, context),
		extend: (next: readonly TuiFieldAdapter[]) => {
			validateAdapters(next, adapters);
			return registry(Object.freeze([...next.map(captureAdapter), ...adapters]), "extend");
		},
		replace: (next: readonly TuiFieldAdapter[]) => {
			validateAdapters(next);
			return registry(Object.freeze(next.map(captureAdapter)), "replace");
		},
	});
}

function captureAdapter(adapter: TuiFieldAdapter): TuiFieldAdapter {
	return Object.freeze({ id: adapter.id, matches: adapter.matches, create: adapter.create });
}

function resolve(adapters: readonly TuiFieldAdapter[], context: TuiFieldAdapterContext): TuiFieldAdapterResolution {
	const path = context.field.path;
	if (isMaskedField(context.field)) {
		return { adapterId: maskedAdapter.id, codec: maskedCodec, diagnostics: [] };
	}
	for (const adapter of adapters) {
		try {
			if (!adapter.matches(context)) continue;
			if (adapter === selectAdapter) {
				const optionFailure = validateOptions(context.options, path);
				if (optionFailure) return optionFailure;
			}
			return { adapterId: adapter.id, codec: adapter.create(context), diagnostics: [] };
		} catch {
			return failure("Field adapter failed", path);
		}
	}
	return failure("Unsupported field", path);
}

export function resolveMandatoryMaskedField(context: TuiFieldAdapterContext): TuiFieldAdapterResolution | undefined {
	return isMaskedField(context.field)
		? { adapterId: maskedAdapter.id, codec: maskedCodec, diagnostics: [] }
		: undefined;
}

export function isMaskedField(field: SchemaFieldInfo): boolean {
	return field.metadata?.writeOnly === true || field.metadata?.widget === "password";
}

function validateAdapters(adapters: readonly TuiFieldAdapter[], existing: readonly TuiFieldAdapter[] = []): void {
	const ids = new Set(existing.map(({ id }) => id));
	for (const adapter of adapters) {
		if (adapter.id.trim().length === 0) throw new TypeError("Field adapter id must be nonempty");
		if (ids.has(adapter.id)) throw new TypeError(`Duplicate field adapter id: ${adapter.id}`);
		ids.add(adapter.id);
	}
}

function validateOptions(options: readonly FormbarOption[], path: string): TuiFieldAdapterResolution | undefined {
	const values: TuiPrimitive[] = [];
	for (const option of options) {
		if (!isPrimitive(option.value) || (typeof option.value === "number" && !Number.isFinite(option.value))) {
			return optionFailure("Unsupported option value", path);
		}
		if (values.some((value) => Object.is(value, option.value))) return optionFailure("Duplicate option value", path);
		values.push(option.value);
	}
	return undefined;
}

function optionFailure(message: string, path: string): TuiFieldAdapterResolution {
	return { diagnostics: [{ code: "unsupported-option-value", severity: "error", message, path }] };
}

function isPrimitive(value: unknown): value is TuiPrimitive {
	return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function plainMetadata(context: TuiFieldAdapterContext): boolean {
	const { format, widget } = metadata(context) ?? {};
	return format === undefined && (widget === undefined || widget === "text" || widget === "input");
}

function isBuiltInPrimitiveType(type: SchemaFieldInfo["type"]): boolean {
	return type === "string" || type === "integer" || type === "number" || type === "boolean";
}

function possibleNumber(value: string, integer: boolean): boolean {
	if (value === "" || value === "-") return true;
	if (integer) return /^-?(?:0|[1-9]\d*)$/.test(value);
	return /^-?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d*)?$/.test(value);
}

function completeNumber(value: string, integer: boolean): boolean {
	if (integer) return /^-?(?:0|[1-9]\d*)$/.test(value);
	return /^-?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
}

function withinBounds(value: number, bounds: Record<string, unknown> | undefined): boolean {
	if (typeof bounds?.minimum === "number" && value < bounds.minimum) return false;
	if (typeof bounds?.maximum === "number" && value > bounds.maximum) return false;
	if (typeof bounds?.exclusiveMinimum === "number" && value <= bounds.exclusiveMinimum) return false;
	if (typeof bounds?.exclusiveMaximum === "number" && value >= bounds.exclusiveMaximum) return false;
	return true;
}

export const DEFAULT_TUI_FIELD_ADAPTER_REGISTRY = createTuiFieldAdapterRegistry();
