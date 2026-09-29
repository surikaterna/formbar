import { type JsonValue, copyJson } from "@formbar/expressions";
import type {
	DataContext,
	DirectWriteRequest,
	DirectWriteResult,
	EnumeratedRow,
	FormbarDataStrategyV1,
	ReadScope,
} from "./kalada-data-strategy.js";
import type { AdmittedDefinition } from "./kalada-definition.js";
import { type TrustedDirectLocations, checkPrivateDirectLocation } from "./kalada-direct-location.js";
import { writeNode } from "./kalada-write-node.js";

interface WriteOptions {
	readonly path: string;
	readonly row: EnumeratedRow | undefined;
	readonly value: unknown;
	readonly admitted: AdmittedDefinition;
	readonly strategy: FormbarDataStrategyV1;
	readonly context: DataContext;
	readonly valid: () => boolean;
	readonly revision: () => number;
	readonly expectedFormRevision?: object;
	readonly validScope: (scope: ReadScope, enclosing?: string) => boolean;
}

/** Only the installed host can decide and commit. This function never converts a row to a position. */
export function directWrite(options: WriteOptions): DirectWriteResult {
	const { path, row, value, admitted, strategy, context, valid, revision, validScope } = options;
	try {
		if (!strategy.writeDirect) return { status: "unsupported" };
		if (!valid()) return { status: "stale" };
		const field = writeNode(path, admitted);
		const reference = admitted.targets.get(path);
		if (!field || !reference || reference.namespace !== "data" || !reference.path.length)
			return { status: "invalid-target" };
		const scoped = field.enclosingScope !== undefined;
		if (scoped) {
			if (!row || !validScope(row.scope, field.enclosingScope) || row.scope.rows.length === 0)
				return { status: "invalid-target" };
			if (row.scope.rows.at(-1)?.token !== row.token || typeof row.writeRevision !== "object" || !row.writeRevision)
				return { status: "invalid-target" };
		} else if (row !== undefined) return { status: "invalid-target" };
		const safe: JsonValue = copyJson(value);
		const start = revision();
		const frame = strategy.capture(context);
		if (
			frame.instance !== context.instance ||
			revision() !== start ||
			frame.token !== strategy.current(context) ||
			!valid()
		)
			return { status: "stale" };
		if (options.expectedFormRevision && frame.token !== options.expectedFormRevision) return { status: "stale" };
		const base = {
			contract: "formbar-direct-write-v1",
			reference,
			expectedInstance: context.instance,
			expectedRevision: frame.token,
			value: safe,
		} as const;
		const request: DirectWriteRequest = row
			? {
					...base,
					targetKind: "row",
					scope: Object.freeze({
						rows: Object.freeze(row.scope.rows.map(({ name, token }) => Object.freeze({ name, token }))),
					}),
					expectedRowRevision: row.writeRevision as object,
				}
			: { ...base, targetKind: "non-repeater", scope: Object.freeze({ rows: Object.freeze([] as const) }) };
		return strategy.writeDirect(context, Object.freeze(request));
	} catch {
		return { status: "invalid-target" };
	}
}

/** Bind host-issued identity and expected revisions; invocation still delegates authority to the live host. */
function snapshotRow(row: EnumeratedRow, writeRevision: object) {
	return Object.freeze({
		token: row.token,
		order: row.order,
		writeRevision,
		scope: Object.freeze({
			rows: Object.freeze(row.scope.rows.map(({ name, token }) => Object.freeze({ name, token }))),
		}),
	});
}

export function bindRowWrite(
	options: Omit<WriteOptions, "value" | "expectedFormRevision"> & {
		readonly row: EnumeratedRow;
		readonly source: string;
		readonly locations: TrustedDirectLocations | undefined;
	},
): ((value: unknown) => DirectWriteResult) | undefined {
	const { path, row, admitted, strategy, context, valid, revision, validScope, source, locations } = options;
	try {
		const field = writeNode(path, admitted);
		if (!field?.enclosingScope || !validScope(row.scope, field.enclosingScope)) return;
		if (row.scope.rows.at(-1)?.token !== row.token || !row.writeRevision || !row.formRevision) return;
		if (!valid() || !checkPrivateDirectLocation(path, source, admitted, locations)?.ok) return;
		const frame = strategy.capture(context);
		if (
			frame.instance !== context.instance ||
			frame.token !== strategy.current(context) ||
			frame.token !== row.formRevision
		)
			return;
		const expectedFormRevision = row.formRevision;
		const bound = snapshotRow(row, row.writeRevision);
		return (value: unknown) => {
			try {
				if (!checkPrivateDirectLocation(path, source, admitted, locations)?.ok) return { status: "invalid-target" };
			} catch {
				return { status: "invalid-target" };
			}
			return directWrite({
				path,
				row: bound,
				value,
				admitted,
				strategy,
				context,
				valid,
				revision,
				validScope,
				expectedFormRevision,
			});
		};
	} catch {
		return;
	}
}

export function privateWritePorts(
	options: Omit<WriteOptions, "path" | "row" | "value"> & {
		readonly locations: TrustedDirectLocations | undefined;
	},
) {
	const { admitted, strategy, context, valid, revision, validScope, locations } = options;
	const writeDirect = (path: string, row: EnumeratedRow | undefined, value: unknown) =>
		directWrite({ path, row, value, admitted, strategy, context, valid, revision, validScope });
	return {
		writeDirect,
		writeChecked(path: string, source: string, value: unknown) {
			if (!valid()) return { status: "stale" as const };
			if (!checkPrivateDirectLocation(path, source, admitted, locations)?.ok)
				return { status: "invalid-target" as const };
			return writeDirect(path, undefined, value);
		},
		bindRowWrite: (path: string, source: string, row: EnumeratedRow) =>
			bindRowWrite({ path, source, row, admitted, strategy, context, valid, revision, validScope, locations }),
		bindDirectWrite(path: string, source: string) {
			try {
				if (!valid() || !checkPrivateDirectLocation(path, source, admitted, locations)?.ok) return;
				const frame = strategy.capture(context);
				if (frame.instance !== context.instance || frame.token !== strategy.current(context)) return;
				return (value: unknown) => {
					if (!checkPrivateDirectLocation(path, source, admitted, locations)?.ok)
						return { status: "invalid-target" as const };
					return directWrite({
						path,
						row: undefined,
						value,
						admitted,
						strategy,
						context,
						valid,
						revision,
						validScope,
						expectedFormRevision: frame.token,
					});
				};
			} catch {
				return;
			}
		},
		checkDirectLocation: (path: string, source: string) =>
			checkPrivateDirectLocation(path, source, admitted, locations),
	};
}
