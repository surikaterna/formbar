import type { JsonValue } from "@formbar/expressions";
import { type RecordValue, exact, identifier, object } from "./kalada-definition-shape.js";
import { ProgramAdmissionError } from "./kalada-program.js";

export function optionalString(value: JsonValue | undefined, path: string): void {
	if (value !== undefined && typeof value !== "string") throw new ProgramAdmissionError(path, "INVALID_SHAPE");
}

export function requiredString(value: JsonValue | undefined, path: string): void {
	if (typeof value !== "string") throw new ProgramAdmissionError(path, "INVALID_SHAPE");
}

export function requiredId(value: JsonValue | undefined, path: string): void {
	identifier(value, path);
}

export function oneOf(value: JsonValue | undefined, allowed: readonly string[], path: string): void {
	if (value !== undefined && !allowed.includes(value as string)) throw new ProgramAdmissionError(path, "INVALID_SHAPE");
}

export function presentation(value: JsonValue | undefined, path: string): void {
	if (value === undefined) return;
	const source = object(value, path);
	exact(source, ["span"], path);
	if (source.span === undefined) return;
	const spanPath = `${path}.span`;
	if (isSpan(source.span)) return;
	const spans = object(source.span, spanPath);
	exact(spans, ["base", "sm", "md", "lg", "xl"], spanPath);
	for (const [key, span] of Object.entries(spans))
		if (!isSpan(span)) throw new ProgramAdmissionError(`${spanPath}.${key}`, "INVALID_SHAPE");
}

function isSpan(value: JsonValue): boolean {
	return (
		value === "auto" ||
		value === "full" ||
		(typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12)
	);
}

export function repeaterBounds(source: RecordValue, path: string): void {
	for (const key of ["minItems", "maxItems"]) {
		const value = source[key];
		if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0))
			throw new ProgramAdmissionError(`${path}.${key}`, "INVALID_SHAPE");
	}
	if (typeof source.minItems === "number" && typeof source.maxItems === "number" && source.maxItems < source.minItems)
		throw new ProgramAdmissionError(`${path}.maxItems`, "INVALID_SHAPE");
}

const arrays = new Set(["array.append", "array.insert", "array.remove", "array.move", "array.swap"]);
const needsPayload = new Set(["array.append", "array.insert", "array.move", "array.swap"]);
const forbidsPayload = new Set(["submit", "reset", "validate"]);

export function actionShape(source: RecordValue, path: string): void {
	requiredId(source.action, `${path}.action`);
	oneOf(source.concurrency, ["drop", "replace", "queue"], `${path}.concurrency`);
	if (source.payload === undefined && needsPayload.has(source.action as string))
		throw new ProgramAdmissionError(`${path}.payload`, "INVALID_ACTION_PAYLOAD");
	if (source.payload !== undefined && forbidsPayload.has(source.action as string))
		throw new ProgramAdmissionError(`${path}.payload`, "INVALID_ACTION_PAYLOAD");
	if (source.target === undefined && arrays.has(source.action as string))
		throw new ProgramAdmissionError(`${path}.target`, "INVALID_ACTION_TARGET");
	if (source.target !== undefined && !arrays.has(source.action as string))
		throw new ProgramAdmissionError(`${path}.target`, "INVALID_ACTION_TARGET");
}

export function submission(value: JsonValue | undefined): void {
	if (value === undefined) return;
	const source = object(value, "submission");
	exact(source, ["hiddenValues"], "submission");
	if (source.hiddenValues !== "include" && source.hiddenValues !== "omit-inactive")
		throw new ProgramAdmissionError("submission.hiddenValues", "INVALID_SHAPE");
}
