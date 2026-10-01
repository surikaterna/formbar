import type { KaladaV1Control } from "@formbar/declarative";

const text = new Set(["text", "email", "url", "tel", "password", "search", "textarea"]);

function number(value: unknown, path: string, positive = false) {
	if (value === undefined) return;
	if (typeof value !== "number" || !Number.isFinite(value) || (positive && value <= 0))
		throw new TypeError(`${path}: INVALID_NATIVE_CONSTRAINT`);
	return value;
}
function string(value: unknown, path: string, limit = 4096) {
	if (value === undefined) return;
	if (typeof value !== "string" || value.length > limit) throw new TypeError(`${path}: INVALID_NATIVE_CONSTRAINT`);
	return value;
}
function length(value: unknown, path: string) {
	const result = number(value, path);
	if (result !== undefined && (!Number.isSafeInteger(result) || result < 0))
		throw new TypeError(`${path}: INVALID_NATIVE_CONSTRAINT`);
	return result;
}

export function nativeInputType(control: KaladaV1Control) {
	if (control.rendererId === "text")
		return (
			({ email: "email", uri: "url", date: "date", time: "time" } as Record<string, string>)[
				String(control.props.format)
			] ?? "text"
		);
	return ["number", "date", "time", "email", "url", "tel", "password", "search"].includes(control.rendererId)
		? control.rendererId
		: "text";
}

/** Explicit attribute construction only. Props/events/styles are never blindly spread from the definition. */
export function nativeAttributes(control: KaladaV1Control, type: string) {
	const props = control.props;
	const path = `${control.path}.props`;
	const placeholder =
		text.has(type) || type === "number" ? string(props.placeholder, `${path}.placeholder.value`) : undefined;
	if (type === "number")
		return {
			min: number(props.min, `${path}.min.value`),
			max: number(props.max, `${path}.max.value`),
			step: props.step === undefined || props.step === "any" ? "any" : number(props.step, `${path}.step.value`, true),
			placeholder,
		};
	if (type === "date" || type === "time")
		return {
			min: string(props.min, `${path}.min.value`, 32),
			max: string(props.max, `${path}.max.value`, 32),
			step:
				props.step === "any"
					? "any"
					: (number(props.step, `${path}.step.value`, true) ?? (type === "time" ? "any" : 1)),
		};
	if (text.has(type))
		return {
			minLength: length(props.minLength, `${path}.minLength.value`),
			maxLength: length(props.maxLength, `${path}.maxLength.value`),
			...(type === "textarea" ? {} : { pattern: string(props.pattern, `${path}.pattern.value`, 1024) }),
			placeholder,
		};
	return {};
}
