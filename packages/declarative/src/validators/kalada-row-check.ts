import type { EnumeratedRow, ReadScope } from "./kalada-data-strategy.js";

export function checkedRows(
	raw: readonly EnumeratedRow[],
	parent: ReadScope,
	name: string,
	formRevision: object,
): readonly EnumeratedRow[] | undefined {
	const seen = new Set<object>();
	const rows: EnumeratedRow[] = [];
	for (const [order, row] of raw.entries()) {
		if (
			!row ||
			typeof row.token !== "object" ||
			row.token === null ||
			seen.has(row.token) ||
			row.order !== order ||
			!row.scope ||
			!Array.isArray(row.scope.rows) ||
			row.scope.rows.length !== parent.rows.length + 1 ||
			parent.rows.some(
				(ancestor, index) =>
					row.scope.rows[index]?.name !== ancestor.name || row.scope.rows[index]?.token !== ancestor.token,
			) ||
			row.scope.rows[parent.rows.length]?.name !== name ||
			row.scope.rows[parent.rows.length]?.token !== row.token
		)
			return undefined;
		seen.add(row.token);
		rows.push(
			Object.freeze({
				token: row.token,
				order,
				formRevision,
				...(typeof row.writeRevision === "object" && row.writeRevision !== null
					? { writeRevision: row.writeRevision }
					: {}),
				scope: Object.freeze({
					rows: Object.freeze(row.scope.rows.map(({ name, token }) => Object.freeze({ name, token }))),
				}),
			}),
		);
	}
	return Object.freeze(rows);
}
