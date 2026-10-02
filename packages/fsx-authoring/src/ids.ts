import { FsxError } from "./errors.js";
import type { Element, FsxDiagnosticLocation, SourceRange } from "./types.js";

type Declaration = FsxDiagnosticLocation & { readonly tag: string; readonly range: SourceRange };

function reject(code: string, message: string, path: string, range: SourceRange): never {
	throw new FsxError({ code, message, path, range });
}

export function declareId(element: Element, declarations: Map<string, Declaration>): string {
	const path = `${element.authoringPath}.id`;
	const entry = element.attributes.get("id");
	if (!entry)
		reject("MISSING_ID", `<${element.name}> needs a static id. Add a unique element ID.`, path, element.range);
	if (entry.value.kind !== "literal" || typeof entry.value.value !== "string")
		reject(
			"NON_STATIC_ID",
			`<${element.name}> needs a static, double-quoted ID, not an expression.`,
			path,
			entry.valueRange,
		);
	const id = entry.value.value;
	if (!id)
		reject("EMPTY_ID", `<${element.name}> has an empty ID. Choose a nonempty element ID.`, path, entry.valueRange);
	// Match the public V1 identifier contract; it imposes no ASCII or punctuation restriction.
	if (id.length > 256 || ["__proto__", "constructor", "prototype"].includes(id))
		reject(
			"INVALID_ID",
			`ID ${JSON.stringify(id)} must be at most 256 UTF-16 units and cannot be __proto__, constructor, or prototype.`,
			path,
			entry.valueRange,
		);
	const first = declarations.get(id);
	if (first)
		throw new FsxError({
			code: "DUPLICATE_ID",
			message: `ID ${JSON.stringify(id)} is already used by <${first.tag}>. Choose a unique element ID; both may still bind to the same field.`,
			path,
			range: entry.valueRange,
			related: [{ message: `First declared on <${first.tag}> here.`, path: first.path, range: first.range }],
		});
	declarations.set(id, { tag: element.name, message: `Declared on <${element.name}>.`, path, range: entry.valueRange });
	return id;
}
