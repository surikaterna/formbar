/** The host passes an evaluated value, never a definition expression. */
export type KaladaOutputFormat409 = "plain" | "number" | "currency-usd" | "percent";
export type KaladaFormattedOutput409 =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly diagnostic: "unsupported-output-value" };

const invalid: KaladaFormattedOutput409 = { ok: false, diagnostic: "unsupported-output-value" };

export function formatKaladaOutput409(
	value: unknown,
	format: KaladaOutputFormat409 = "plain",
): KaladaFormattedOutput409 {
	if (value === null) return { ok: true, text: "Not available" };
	if (format === "plain") {
		if (typeof value === "string") return { ok: true, text: value };
		if (typeof value === "boolean") return { ok: true, text: value ? "True" : "False" };
		if (typeof value === "number" && Number.isFinite(value)) return { ok: true, text: String(value) };
		return invalid;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) return invalid;
	if (format !== "number" && format !== "currency-usd" && format !== "percent") return invalid;
	try {
		const options: Intl.NumberFormatOptions =
			format === "number"
				? { maximumFractionDigits: 2 }
				: format === "currency-usd"
					? { style: "currency", currency: "USD" }
					: { style: "percent", maximumFractionDigits: 2 };
		return { ok: true, text: new Intl.NumberFormat("en-US", options).format(value) };
	} catch {
		return invalid;
	}
}
