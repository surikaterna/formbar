import type { KaladaV1Snapshot } from "@formbar/declarative";

function keyed<T extends { readonly key: string }>(entries: readonly T[], kind: string) {
	const result = new Map<string, T>();
	for (const entry of entries) {
		if (typeof entry.key !== "string") throw new TypeError(`INVALID_${kind}_KEY`);
		if (result.has(entry.key)) throw new TypeError(`${entry.key}: DUPLICATE_${kind}`);
		result.set(entry.key, entry);
	}
	return result;
}

/** Presentation indexes only; keys never grant reads, writes, or positional row ownership. */
export function indexKaladaView(view: KaladaV1Snapshot) {
	return { controls: keyed(view.controls, "CONTROL"), outputs: keyed(view.outputs, "OUTPUT") };
}
