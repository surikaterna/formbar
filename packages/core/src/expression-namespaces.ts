import { CallbackBoundary, failure, resolveRef } from "@formbar/expressions";
import type { JsonValue, NamespaceProvider, Segment, WriteResult } from "@formbar/expressions";
import type { FormApi } from "./contracts.js";
import { parsePath } from "./path-parser.js";
import type { Namespace } from "./path.js";

function mutationPath(namespace: Namespace, segments: readonly Segment[]): string | undefined {
	resolveRef({ namespace, segments });
	if (!segments.length) return undefined;
	const escaped = segments.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1"));
	const path = `/${namespace === "ui" ? "$ui/" : ""}${escaped.join("/")}`;
	const parsed = parsePath(path);
	if (parsed.namespace !== namespace || parsed.segments.some((part, i) => String(part) !== String(segments[i])))
		return undefined;
	return path;
}

function provider<TData, TUi>(form: FormApi<TData, TUi>, namespace: Namespace): NamespaceProvider {
	return {
		getSnapshot: () => (namespace === "data" ? form.getState().data : form.getState().uiState),
		isDisposed: form.isDisposed,
		subscribe(listener) {
			const state = form.subscribe(listener);
			const disposal = form.onDispose(listener);
			return () => {
				const boundary = new CallbackBoundary();
				boundary.runAll([state, disposal]);
				if (boundary.getDiagnostics().length) throw new Error("adapter");
			};
		},
		write(segments: readonly Segment[], value: JsonValue): WriteResult {
			if (form.isDisposed()) return failure("disposed");
			const path = mutationPath(namespace, segments);
			if (!path) return failure("read-only");
			return form.dispatch({ type: "set-value", path, value, origin: "expression" });
		},
	};
}

/** Adds no store or evaluator; every write traverses the existing core pipeline. */
export function createCoreExpressionNamespaces<TData, TUi>(
	form: FormApi<TData, TUi>,
): Readonly<Record<Namespace, NamespaceProvider>> {
	return Object.freeze({ data: provider(form, "data"), ui: provider(form, "ui") });
}
