import type { JsonValue } from "@formbar/expressions";
import type { DiagnosticPathSegment } from "../diagnostics.js";
import type { NodePresentation, ResponsiveSpan } from "../presentation.js";
import { type ValidationContext, diagnostic } from "./context.js";
import { exactKeys, record } from "./shape.js";

const BREAKPOINTS = new Set(["base", "sm", "md", "lg", "xl"]);

export function presentation(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): NodePresentation | undefined {
	if (value === undefined) return undefined;
	const source = record(value, path, context);
	if (!source) return undefined;
	exactKeys(source, new Set(["span"]), path, context);
	const span = source.span === undefined ? undefined : responsiveSpan(source.span, [...path, "span"], context);
	return Object.freeze({ ...(span === undefined ? {} : { span }) });
}

function responsiveSpan(
	value: JsonValue,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): ResponsiveSpan | undefined {
	if (isSpan(value)) return value;
	const source = record(value, path, context);
	if (!source) return undefined;
	exactKeys(source, BREAKPOINTS, path, context);
	const output: Record<string, ResponsiveSpan> = Object.create(null);
	for (const [breakpoint, span] of Object.entries(source)) {
		if (isSpan(span)) output[breakpoint] = span;
		else diagnostic(context, "invalid-range", [...path, breakpoint], "Expected span 1..12, 'auto', or 'full'.");
	}
	return Object.freeze(output) as ResponsiveSpan;
}

const isSpan = (value: JsonValue): value is 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | "auto" | "full" =>
	value === "auto" ||
	value === "full" ||
	(typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12);
