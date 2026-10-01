import type { JsonValue } from "@formbar/declarative";
import type { CreateKaladaV1HostOptions } from "@formbar/declarative";

type Strategy = CreateKaladaV1HostOptions["strategy"];
type Capture = ReturnType<Strategy["capture"]>;
type Reference = Parameters<Capture["read"]>[0];
type Scope = Parameters<Capture["read"]>[1];
export type Row = { token: object; revision: object; value: JsonValue };
export type Status = {
	submitCount: number;
	dirty: boolean;
	touched: boolean;
	validating: boolean;
	submitted: boolean;
	valid: boolean;
	issues: { schema: string[]; extension: string[] };
};
export const empty = (): Status => ({
	submitCount: 0,
	dirty: false,
	touched: false,
	validating: false,
	submitted: false,
	valid: true,
	issues: { schema: [], extension: [] },
});
export const clone = (value: JsonValue): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
export const key = (path: readonly (string | number)[]) => JSON.stringify(path);

export function currentRow(
	rows: ReadonlyMap<string, readonly Row[]>,
	reference: Reference,
	scope: Scope,
	location: readonly (string | number)[],
	expected: object,
): boolean {
	let last: Row | undefined;
	let ordinal = 0;
	for (const [marker, binding] of reference.path.entries()) {
		if (typeof binding !== "object") continue;
		const index = location[marker];
		if (typeof index !== "number") return false;
		const owned = rows.get(key(location.slice(0, marker)))?.[index];
		const named = scope.rows[ordinal++];
		if (!owned || !named || named.name !== binding.row || named.token !== owned.token) return false;
		last = owned;
	}
	return ordinal === scope.rows.length && last?.revision === expected;
}
