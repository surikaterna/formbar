import type { SubmitDataPath, SubmitJson, SubmitStructuralWitness } from "@formbar/core";
import type { AbsoluteBinding } from "./bindings.js";

type Path = SubmitDataPath;
const unsafe = new Set(["__proto__", "constructor", "prototype"]);
export const typedPath = (binding: AbsoluteBinding): Path => {
	if (binding.namespace !== "data" || !binding.segments.length || binding.segments.length > 32) throw Error("binding");
	return binding.segments.map((segment) => {
		if (typeof segment === "number") {
			if (!Number.isSafeInteger(segment) || segment < 0) throw Error("index");
			return { kind: "index", index: segment } as const;
		}
		if (!segment || unsafe.has(segment)) throw Error("key");
		return { kind: "key", key: segment } as const;
	});
};

export const pathId = (path: Path): string =>
	JSON.stringify(path.map((s) => (s.kind === "key" ? ["key", s.key] : ["index", s.index])));
export const overlaps = (a: Path, b: Path): boolean =>
	pathId(a.slice(0, Math.min(a.length, b.length))) === pathId(b.slice(0, Math.min(a.length, b.length)));

export function valueAt(root: SubmitJson, path: Path): SubmitJson | undefined {
	let value: SubmitJson | undefined = root;
	for (const part of path) {
		if (part.kind === "index") value = Array.isArray(value) ? value[part.index] : undefined;
		else
			value =
				value && !Array.isArray(value) && typeof value === "object"
					? (value as Record<string, SubmitJson>)[part.key]
					: undefined;
	}
	return value;
}

export function remove(root: SubmitJson, path: Path): void {
	const parent = valueAt(root, path.slice(0, -1));
	const last = path.at(-1);
	if (
		!last ||
		last.kind !== "key" ||
		!parent ||
		Array.isArray(parent) ||
		typeof parent !== "object" ||
		!Object.hasOwn(parent, last.key)
	)
		throw Error("missing object property");
	delete (parent as Record<string, SubmitJson>)[last.key];
}

function primitive(row: SubmitJson, key: string): string | undefined {
	if (!row || Array.isArray(row) || typeof row !== "object" || !Object.hasOwn(row, key)) return undefined;
	const value = (row as Record<string, SubmitJson>)[key];
	return value === null || typeof value === "object" ? undefined : JSON.stringify(value);
}

function rowKey(rows: readonly SubmitJson[], projected: readonly SubmitJson[]): Path {
	const first = rows[0];
	if (!first || Array.isArray(first) || typeof first !== "object") throw Error("row");
	for (const key of Object.keys(first)) {
		if (!key || unsafe.has(key)) continue;
		const values = rows.map((row) => primitive(row, key));
		if (values.some((value) => value === undefined) || new Set(values).size !== rows.length) continue;
		if (projected.every((row, index) => primitive(row, key) === values[index])) return [{ kind: "key", key }];
	}
	throw Error("missing unique row anchor");
}

export function anchors(
	original: SubmitJson,
	projected: SubmitJson,
	omitted: readonly Path[],
): SubmitStructuralWitness["rowAnchors"] {
	const arrays = new Map<string, Path>();
	for (const path of omitted)
		for (let i = 0; i < path.length; i++)
			if (path[i]?.kind === "index") arrays.set(pathId(path.slice(0, i)), path.slice(0, i));
	return [...arrays.values()].map((array) => {
		const rows = valueAt(original, array);
		const retained = valueAt(projected, array);
		if (!Array.isArray(rows) || !Array.isArray(retained) || rows.length === 0 || rows.length !== retained.length)
			throw Error("missing rows");
		return { array, key: rowKey(rows, retained) };
	});
}
