import { ProgramAdmissionError } from "./kalada-program.js";

export type KaladaSpan409 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | "auto" | "full";
export type KaladaFormat409 = "plain" | "number" | "currency-usd" | "percent";
const breakpoints = new Set(["base", "sm", "md", "lg", "xl"]);
const formats = new Set(["plain", "number", "currency-usd", "percent"]);

function span(value: unknown, path: string): KaladaSpan409 {
	if (value === "auto" || value === "full") return value;
	if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12) return value as KaladaSpan409;
	throw new ProgramAdmissionError(path, "INVALID_RANGE");
}

/** Validate presentation without evaluating any slot or accepting definition-supplied callbacks. */
export function checkKaladaPresentation409(value: unknown, path: string): void {
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ProgramAdmissionError(path, "INVALID_SHAPE");
	const record = value as Record<string, unknown>;
	for (const name of Object.keys(record))
		if (name !== "span") throw new ProgramAdmissionError(`${path}.${name}`, "UNKNOWN_KEY");
	if (record.span === undefined) return;
	if (!record.span || typeof record.span !== "object" || Array.isArray(record.span)) {
		span(record.span, `${path}.span`);
		return;
	}
	for (const [name, value] of Object.entries(record.span)) {
		if (!breakpoints.has(name)) throw new ProgramAdmissionError(`${path}.span.${name}`, "UNKNOWN_KEY");
		span(value, `${path}.span.${name}`);
	}
}

export function checkKaladaOutputFormat409(value: unknown, path: string): KaladaFormat409 {
	if (value === undefined) return "plain";
	if (typeof value !== "string" || !formats.has(value)) throw new ProgramAdmissionError(path, "INVALID_OUTPUT_FORMAT");
	return value as KaladaFormat409;
}
