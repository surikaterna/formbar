import { ProgramAdmissionError } from "./kalada-program.js";
import { type StaticPathPart, type StaticReference, staticDependencyKey } from "./static-references.js";

export interface AttestedPath {
	readonly path: readonly StaticPathPart[];
	readonly kind: "array" | "value";
}

export interface PathAuthority {
	readonly availability: "complete" | "partial" | "unavailable";
	readonly paths: readonly AttestedPath[];
}

function validPart(part: unknown): boolean {
	return (
		(typeof part === "string" &&
			!!part &&
			part.length <= 256 &&
			!["__proto__", "prototype", "constructor"].includes(part)) ||
		(typeof part === "number" && Number.isSafeInteger(part) && part >= 0) ||
		(part !== null &&
			typeof part === "object" &&
			Object.keys(part).length === 1 &&
			Object.hasOwn(part, "row") &&
			typeof (part as { row: unknown }).row === "string" &&
			!!(part as { row: string }).row &&
			(part as { row: string }).row.length <= 256 &&
			!["__proto__", "prototype", "constructor"].includes((part as { row: string }).row))
	);
}

export function validatePathAuthority(input: unknown, path: string): asserts input is PathAuthority {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new ProgramAdmissionError(path, "INVALID_POLICY");
	const value = input as Record<string, unknown>;
	if (
		Object.keys(value).some((key) => !["availability", "paths"].includes(key)) ||
		!["complete", "partial", "unavailable"].includes(String(value.availability)) ||
		!Array.isArray(value.paths) ||
		value.paths.length > 4096
	)
		throw new ProgramAdmissionError(path, "INVALID_POLICY");
	const seen = new Set<string>();
	for (const [index, entry] of value.paths.entries()) {
		const at = `${path}.paths[${index}]`;
		if (!entry || typeof entry !== "object" || Array.isArray(entry))
			throw new ProgramAdmissionError(at, "INVALID_POLICY");
		const item = entry as Record<string, unknown>;
		if (
			Object.keys(item).some((key) => !["path", "kind"].includes(key)) ||
			!Array.isArray(item.path) ||
			item.path.length > 64 ||
			!item.path.every(validPart) ||
			(item.kind !== "array" && item.kind !== "value")
		)
			throw new ProgramAdmissionError(at, "INVALID_POLICY");
		const key = staticDependencyKey({ namespace: "data", path: item.path });
		if (seen.has(key)) throw new ProgramAdmissionError(at, "INVALID_POLICY");
		seen.add(key);
	}
}

export function checkAttestedPath(
	ref: StaticReference,
	path: string,
	data: PathAuthority,
	ui: PathAuthority,
	kind?: "array",
	write = false,
): void {
	const authority = ref.namespace === "data" ? data : ui;
	if (authority.availability !== "complete") throw new ProgramAdmissionError(path, "MISSING_PATH_AUTHORITY");
	if (write && ref.path.some((part) => typeof part === "number"))
		throw new ProgramAdmissionError(path, "INVALID_BINDING");
	const key = staticDependencyKey(ref);
	if (
		!authority.paths.some(
			(entry) =>
				staticDependencyKey({ namespace: ref.namespace, path: entry.path }) === key && (!kind || entry.kind === kind),
		)
	)
		throw new ProgramAdmissionError(path, "UNATTESTED_PATH");
}
