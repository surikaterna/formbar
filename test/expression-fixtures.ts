import type { Expression, JsonValue, NamespaceProvider, Segment } from "@formbar/expressions";

export const literal = (value: JsonValue): Expression => ({ kind: "literal", value });
export const ref = (name: string, namespace = "data"): Extract<Expression, { kind: "ref" }> => ({
	kind: "ref",
	ref: { namespace, segments: [name] },
});
export const op = (name: string, ...args: Expression[]): Expression => ({ kind: "op", op: name, args });

export function namespace(initial: unknown) {
	let root = initial;
	let version = 0;
	const listeners = new Set<() => void>();
	const writes: { segments: readonly Segment[]; value: JsonValue }[] = [];
	const provider: NamespaceProvider = {
		getSnapshot: () => root,
		getVersion: () => version,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		write(segments, value) {
			writes.push({ segments, value });
			return { ok: true };
		},
	};
	const emit = () => {
		for (const listener of [...listeners]) listener();
	};
	return {
		provider,
		listeners,
		writes,
		emit,
		replace(value: unknown) {
			root = value;
			emit();
		},
		revoke() {
			version++;
			emit();
		},
	};
}
