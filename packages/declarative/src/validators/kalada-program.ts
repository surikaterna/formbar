import { type JsonValue, copyJson, parseRef } from "@formbar/expressions";
import { type KaladaV1Program, compileKaladaV1Program } from "@kalada/core";
import { type StaticReference, resolveStaticReference } from "./static-references.js";

// Kalada's JsonValue constraint structurally requires a string index signature for its generic
// reference DTO. This is not permission to accept extra keys: validReference rejects them at runtime.
export type KaladaReference = {
	namespace: "data" | "ui" | "form" | "field";
	segments: (string | number)[];
	[key: string]: string | (string | number)[];
};

export interface AdmittedProgram {
	readonly program: KaladaV1Program<KaladaReference>;
	readonly dependencies: readonly StaticReference[];
}

export class ProgramAdmissionError extends Error {
	constructor(
		readonly path: string,
		readonly code: string,
	) {
		super(`${path}: ${code}${code === "RE-AUTHOR" ? " as a Kalada V1 program" : ""}`);
	}
}

const limits = {
	maxAstDepth: 16,
	maxAstNodes: 128,
	maxValueDepth: 16,
	maxValueNodes: 256,
	maxReferenceLength: 1024,
} as const;

function innerPath(slot: string, parts: readonly (string | number)[]): string {
	return parts.reduce<string>(
		(path, part) => (typeof part === "number" ? `${path}[${part}]` : `${path}.${part}`),
		slot,
	);
}

/** Private admission only: no evaluation, instance authorization or definition graph wiring. */
function verifyEnvelope(value: JsonValue, slot: string): void {
	const envelope =
		value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, JsonValue>) : undefined;
	if (envelope && (envelope.kind === "literal" || envelope.kind === "ref" || envelope.kind === "op")) {
		throw new ProgramAdmissionError(slot, "RE-AUTHOR");
	}
	if (
		!envelope ||
		Object.keys(envelope).length !== 4 ||
		envelope.format !== "kalada-program" ||
		envelope.version !== 1 ||
		envelope.profile !== "kalada-v1" ||
		!Object.hasOwn(envelope, "expression")
	) {
		throw new ProgramAdmissionError(slot, "INVALID_PROGRAM");
	}
}

function validReference(input: unknown, scopes: unknown, enclosingScope?: string): input is KaladaReference {
	if (!input || typeof input !== "object" || Array.isArray(input)) return false;
	const keys = Object.keys(input);
	if (keys.some((key) => !["namespace", "segments", "scope"].includes(key))) return false;
	if (!Object.hasOwn(input, "namespace") || !Object.hasOwn(input, "segments")) return false;
	try {
		parseRef(input);
		resolveStaticReference(input, scopes, enclosingScope);
		return true;
	} catch {
		return false;
	}
}

function canonicalReference(ref: KaladaReference): KaladaReference {
	const scope = ref.scope;
	return {
		namespace: ref.namespace,
		segments: [...ref.segments],
		...(typeof scope === "string" ? { scope } : {}),
	};
}

export function admitKaladaProgram(
	input: unknown,
	slot: string,
	scopes: unknown = {},
	enclosingScope?: string,
): AdmittedProgram {
	let value: JsonValue;
	try {
		value = copyJson(input);
	} catch {
		throw new ProgramAdmissionError(slot, "INVALID_PROGRAM");
	}
	verifyEnvelope(value, slot);
	const compiled = compileKaladaV1Program<KaladaReference>(value, {
		limits,
		reference: {
			validate: (ref): ref is KaladaReference => validReference(ref, scopes, enclosingScope),
			canonicalize: canonicalReference,
		},
	});
	if (!compiled.ok) {
		throw new ProgramAdmissionError(innerPath(slot, compiled.diagnostic.path), compiled.diagnostic.code);
	}
	return Object.freeze({
		program: compiled.value.program,
		dependencies: Object.freeze(
			compiled.value.dependencies.map((ref) => resolveStaticReference(ref, scopes, enclosingScope)),
		),
	});
}
