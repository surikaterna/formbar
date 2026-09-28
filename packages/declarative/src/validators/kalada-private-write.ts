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

interface WriteOptions {
	readonly path: string;
	readonly row: EnumeratedRow | undefined;
	readonly value: unknown;
	readonly admitted: AdmittedDefinition;
	readonly strategy: FormbarDataStrategyV1;
	readonly context: DataContext;
	readonly valid: () => boolean;
	readonly revision: () => number;
	readonly validScope: (scope: ReadScope, enclosing?: string) => boolean;
}

/** Only the installed host can decide and commit. This function never converts a row to a position. */
export function directWrite(options: WriteOptions): DirectWriteResult {
	const { path, row, value, admitted, strategy, context, valid, revision, validScope } = options;
	try {
		if (!strategy.writeDirect) return { status: "unsupported" };
		if (!valid()) return { status: "stale" };
		const field = [...admitted.fields.values()].find((node) => `${node.path}.binding` === path);
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
