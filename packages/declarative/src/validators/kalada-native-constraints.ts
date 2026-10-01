import type { JsonValue } from "@formbar/expressions";
import { type RecordValue, object } from "./kalada-definition-shape.js";
import { temporalBound } from "./kalada-native-temporal.js";
import { ProgramAdmissionError } from "./kalada-program.js";

const text = new Set(["text", "email", "url", "tel", "password", "search", "textarea"]);
const common = new Set(["description", "format"]);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const length = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function accepted(widget: string, key: string) {
	if (common.has(key)) return true;
	if (key === "options") return widget === "select" || widget === "radio";
	if (key === "placeholder") return true;
	if (["minLength", "maxLength", "pattern"].includes(key)) return text.has(widget);
	return ["min", "max", "step"].includes(key) && ["number", "date", "time"].includes(widget);
}

function valueMatches(widget: string, key: string, value: unknown) {
	if (key === "options") return Array.isArray(value);
	if (key === "minLength" || key === "maxLength") return length(value);
	if (key === "step") return value === "any" || (finite(value) && value > 0);
	if (key === "min" || key === "max")
		return widget === "number" ? finite(value) : temporalBound(widget, value) !== undefined;
	return typeof value === "string" && value.length <= (key === "pattern" ? 1024 : 4096);
}

function checkPair(values: RecordValue, low: string, high: string, path: string, widget?: string) {
	const a = widget === "date" || widget === "time" ? temporalBound(widget, values[low]) : values[low];
	const b = widget === "date" || widget === "time" ? temporalBound(widget, values[high]) : values[high];
	if (typeof a === "number" && typeof b === "number" && a > b)
		throw new ProgramAdmissionError(`${path}.${high}.value`, "INVALID_NATIVE_CONSTRAINT_RANGE");
}

/** Native literals are presentation, not permission or schema validation. Unknown attributes never reach the DOM. */
export function checkNativeConstraints(widget: string, props: JsonValue | undefined, path: string) {
	if (props === undefined) return;
	const source = object(props, path);
	const format = source.format && object(source.format, `${path}.format`);
	const kind =
		widget === "text" && format && format.mode === "literal" && (format.value === "date" || format.value === "time")
			? format.value
			: widget;
	const values: RecordValue = Object.create(null);
	for (const [key, raw] of Object.entries(source)) {
		const at = `${path}.${key}`;
		const prop = object(raw, at);
		if (prop.mode === "write") throw new ProgramAdmissionError(`${at}.reference`, "UNSUPPORTED_V1_RE-AUTHOR");
		if (!accepted(kind, key)) throw new ProgramAdmissionError(at, "UNSUPPORTED_NATIVE_PROP");
		if (prop.mode !== "literal") throw new ProgramAdmissionError(`${at}.mode`, "NATIVE_LITERAL_REQUIRED");
		if (!valueMatches(kind, key, prop.value))
			throw new ProgramAdmissionError(`${at}.value`, "INVALID_NATIVE_CONSTRAINT");
		if (key === "pattern") {
			try {
				new RegExp(String(prop.value), "v");
			} catch {
				throw new ProgramAdmissionError(`${at}.value`, "INVALID_NATIVE_PATTERN");
			}
		}
		values[key] = prop.value;
	}
	checkPair(values, "min", "max", path, kind);
	checkPair(values, "minLength", "maxLength", path);
}
