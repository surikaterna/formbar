import type { SubmitDataPath, SubmitStructuralWitness } from "./submit-adapter-contract.js";
import { Boundary, freeze, unchanged } from "./submit-candidate-safety.js";

type Json = ReturnType<Boundary["copy"]>;
type Path = SubmitDataPath;
type Plan = SubmitStructuralWitness;
type Failure = { readonly ok: false; readonly code: "unsafe_candidate" | "invalid_witness" };
export type SubmitProofResult = { readonly ok: true; readonly data: Json; readonly plan?: Plan } | Failure;

const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const invalid = (): never => {
	throw new Error("witness");
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const id = (path: Path): string =>
	JSON.stringify(path.map((segment) => (segment.kind === "key" ? ["key", segment.key] : ["index", segment.index])));

function pathValid(path: Path, allowRoot = false): boolean {
	return (
		Array.isArray(path) &&
		(allowRoot || path.length > 0) &&
		path.length <= 32 &&
		path.every(
			(s) =>
				(s.kind === "key" && typeof s.key === "string" && !unsafeKeys.has(s.key) && Object.keys(s).length === 2) ||
				(s.kind === "index" && Number.isSafeInteger(s.index) && s.index >= 0 && Object.keys(s).length === 2),
		)
	);
}

function at(root: Json, path: Path): { exists: boolean; value?: Json } {
	let current: Json = root;
	for (const segment of path) {
		if (segment.kind === "index") {
			if (!Array.isArray(current) || segment.index >= current.length) return { exists: false };
			current = current[segment.index] as Json;
		} else {
			if (!current || Array.isArray(current) || typeof current !== "object" || !Object.hasOwn(current, segment.key))
				return { exists: false };
			current = (current as Record<string, Json>)[segment.key] as Json;
		}
	}
	return { exists: true, value: current };
}

function overlaps(a: Path, b: Path): boolean {
	return id(a.slice(0, Math.min(a.length, b.length))) === id(b.slice(0, Math.min(a.length, b.length)));
}

function compare(original: Json, projected: Json, path: Path, deleted: string[]): void {
	if (Array.isArray(original)) {
		if (!Array.isArray(projected) || original.length !== projected.length) invalid();
		const next = projected as Json[];
		original.forEach((value, index) =>
			compare(value, next[index] as Json, [...path, { kind: "index", index }], deleted),
		);
		return;
	}
	if (original && typeof original === "object") {
		if (!projected || Array.isArray(projected) || typeof projected !== "object") invalid();
		const next = projected as Record<string, Json>;
		for (const key of Object.keys(next)) if (!Object.hasOwn(original, key)) invalid();
		for (const [key, value] of Object.entries(original)) {
			const child = [...path, { kind: "key" as const, key }];
			if (!Object.hasOwn(next, key)) deleted.push(id(child));
			else compare(value, next[key] as Json, child, deleted);
		}
		return;
	}
	if (!same(original, projected)) invalid();
}

function verifyAnchorRows(anchor: Plan["rowAnchors"][number], original: Json, projected: Json, final: Json): void {
	const rows = at(projected, anchor.array).value;
	const before = at(original, anchor.array).value;
	const after = at(final, anchor.array).value;
	if (
		!Array.isArray(rows) ||
		!Array.isArray(before) ||
		!Array.isArray(after) ||
		rows.length !== after.length ||
		rows.length !== before.length
	)
		invalid();
	const identities = new Set<string>();
	for (let i = 0; i < (rows as Json[]).length; i++) {
		const path = [...anchor.array, { kind: "index" as const, index: i }, ...anchor.key];
		const a = at(original, path);
		const b = at(projected, path);
		const c = at(final, path);
		const identity = JSON.stringify(b.value);
		if (
			!a.exists ||
			!b.exists ||
			!c.exists ||
			b.value === null ||
			typeof b.value === "object" ||
			!same(a.value, b.value) ||
			!same(b.value, c.value) ||
			identities.has(identity)
		)
			invalid();
		identities.add(identity);
	}
}

function verifyAnchors(plan: Plan, original: Json, projected: Json, final: Json): void {
	const arrays = new Set<string>();
	for (const omitted of plan.omitted) {
		for (let i = 0; i < omitted.length; i++) {
			if (omitted[i]?.kind === "index") arrays.add(id(omitted.slice(0, i)));
		}
	}
	const declared = new Set<string>();
	for (const anchor of plan.rowAnchors) {
		if (
			!anchor ||
			Object.keys(anchor).sort().join() !== "array,key" ||
			!pathValid(anchor.array, true) ||
			!pathValid(anchor.key)
		)
			invalid();
		const key = id(anchor.array);
		if (!arrays.has(key) || declared.has(key) || anchor.key.some((s) => s.kind !== "key")) invalid();
		declared.add(key);
		verifyAnchorRows(anchor, original, projected, final);
	}
	if (declared.size !== arrays.size) invalid();
}

function verifyOmissions(plan: Plan, original: Json, projected: Json, final: Json, deleted: string[]): void {
	const omitted = new Set<string>();
	for (const path of plan.omitted) {
		if (
			!pathValid(path) ||
			omitted.has(id(path)) ||
			!at(original, path).exists ||
			at(projected, path).exists ||
			at(final, path).exists ||
			!at(projected, path.slice(0, -1)).exists ||
			path[path.length - 1]?.kind !== "key"
		)
			invalid();
		for (let i = 0; i < path.length; i++) {
			const ancestor = path.slice(0, i);
			const before = at(projected, ancestor);
			const after = at(final, ancestor);
			if (
				!before.exists ||
				!after.exists ||
				Array.isArray(before.value) !== Array.isArray(after.value) ||
				typeof before.value !== typeof after.value ||
				before.value === null ||
				after.value === null ||
				(Array.isArray(before.value) && before.value.length !== (after.value as Json[]).length)
			)
				invalid();
		}
		omitted.add(id(path));
	}
	if (omitted.size !== deleted.length || deleted.some((path) => !omitted.has(path))) invalid();
}

function verifyProtected(plan: Plan, projected: Json, final: Json): void {
	const protectedPaths: Path[] = [];
	for (const entry of plan.protected) {
		if (
			!entry ||
			Object.keys(entry).sort().join() !== "path,value" ||
			!pathValid(entry.path) ||
			protectedPaths.some((p) => overlaps(p, entry.path)) ||
			plan.omitted.some((p) => overlaps(p, entry.path))
		)
			invalid();
		protectedPaths.push(entry.path);
		const captured = at(projected, entry.path);
		const result = at(final, entry.path);
		if (!captured.exists || !result.exists || !same(captured.value, entry.value) || !same(result.value, entry.value))
			invalid();
	}
}

function verify(plan: Plan, original: Json, projected: Json, final: Json): void {
	if (
		(plan.kind !== "omission" && plan.kind !== "no-omission") ||
		!Array.isArray(plan.omitted) ||
		!Array.isArray(plan.protected) ||
		!Array.isArray(plan.rowAnchors) ||
		plan.omitted.length + plan.protected.length + plan.rowAnchors.length > 256 ||
		Object.keys(plan).sort().join() !== "kind,omitted,protected,rowAnchors"
	)
		invalid();
	const deleted: string[] = [];
	compare(original, projected, [], deleted);
	if (plan.kind === "no-omission" ? deleted.length !== 0 || plan.omitted.length !== 0 : deleted.length === 0) invalid();
	verifyOmissions(plan, original, projected, final, deleted);
	verifyProtected(plan, projected, final);
	verifyAnchors(plan, original, projected, final);
}

/** Pure final-candidate check. Must run before final validators and handler in the later submit lane.
 * Trusted same-realm callbacks/Proxy traps are not sandboxed; this is not a privacy oracle. */
export function checkSubmitAdapterProof(
	original: unknown,
	projected: unknown,
	witness: (() => unknown) | undefined,
	final: unknown,
	retainPlan = false,
): SubmitProofResult {
	let originals: readonly unknown[] = [];
	let snapshots: readonly Json[] = [];
	let refs: ReadonlySet<object> = new Set();
	try {
		const boundary = new Boundary();
		originals = [original, projected, final];
		snapshots = originals.map((value) => freeze(boundary.copy(value)));
		refs = boundary.refs;
	} catch {
		return { ok: false, code: "unsafe_candidate" };
	}
	try {
		if (typeof witness !== "function") return { ok: false, code: "invalid_witness" };
		const boundary = new Boundary();
		const supplied = witness();
		const checked = freeze(boundary.copy(supplied, refs));
		const plan = checked as unknown as Plan;
		if (originals.some((value, i) => !unchanged(value, snapshots[i] as Json))) invalid();
		verify(plan, snapshots[0] as Json, snapshots[1] as Json, snapshots[2] as Json);
		if (!unchanged(supplied, checked)) invalid();
		return { ok: true, data: snapshots[2] as Json, ...(retainPlan ? { plan } : {}) };
	} catch {
		return { ok: false, code: "invalid_witness" };
	}
}
