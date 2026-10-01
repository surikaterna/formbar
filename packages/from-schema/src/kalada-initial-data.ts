import { copyJson } from "@formbar/expressions";

/** Capture caller data before provider/host calls; reading an accessor is never part of initialization. */
export function captureInitialData(options: object) {
	const property = Object.getOwnPropertyDescriptor(options, "initialData");
	if (!property) {
		if ("initialData" in options) throw new TypeError("Initial data requires an own data property.");
		return undefined;
	}
	if (!("value" in property)) throw new TypeError("Initial data accessors are not supported.");
	return property.value === undefined ? undefined : copyJson(property.value);
}
