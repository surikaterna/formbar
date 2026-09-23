import type { JsonValue, OutputFormat } from "@formbar/declarative";

export type FormattedOutput =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly diagnostic: "unsupported-output-value" };

export function formatOutput(value: JsonValue, format: OutputFormat = "plain"): FormattedOutput {
	if (value === null) return { ok: true, text: "Not available" };
	try {
		if (format === "plain") return formatPlain(value);
		if (typeof value !== "number" || !Number.isFinite(value)) return unsupported();
		if (format === "number") return formattedNumber(value, { maximumFractionDigits: 2 });
		if (format === "currency-usd") return formattedNumber(value, { style: "currency", currency: "USD" });
		return formattedNumber(value, { style: "percent", maximumFractionDigits: 2 });
	} catch {
		return unsupported();
	}
}

function formattedNumber(value: number, options: Intl.NumberFormatOptions): FormattedOutput {
	return { ok: true, text: new Intl.NumberFormat("en-US", options).format(value) };
}

function formatPlain(value: JsonValue): FormattedOutput {
	if (typeof value === "string") return { ok: true, text: value };
	if (typeof value === "boolean") return { ok: true, text: value ? "True" : "False" };
	if (typeof value === "number" && Number.isFinite(value)) return { ok: true, text: String(value) };
	return unsupported();
}

function unsupported(): FormattedOutput {
	return { ok: false, diagnostic: "unsupported-output-value" };
}
