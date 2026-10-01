import type { JsonValue } from "@formbar/declarative";

/** Pinned V1 has no fold. This installed JSON projection is ephemeral, never a draft field. */
export function lineSubtotal(items: JsonValue | undefined): number | undefined {
	if (!Array.isArray(items)) return;
	let total = 0;
	for (const item of items) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return;
		const amount = item.amount;
		if (amount === undefined) continue;
		if (typeof amount !== "number" || !Number.isFinite(amount)) return;
		total += amount;
	}
	return Number.isFinite(total) ? total : undefined;
}
