import type { JsonValue } from "@formbar/declarative";
import type { DescriptorDocument } from "../descriptors/contracts.js";
import type { BindingContext } from "./bindings.js";
import { compileKaladaOccurrence } from "./compile-kalada-occurrence.js";

/** All generated occurrence paths use the same direct Kalada V1 compiler. */
export function compileOccurrence(
	document: DescriptorDocument,
	id: string,
	context: BindingContext,
	path: string,
): JsonValue {
	return compileKaladaOccurrence(document, id, context, path);
}
