import type { JsonValue } from "@formbar/declarative";
import type { JsonValue as KaladaJsonValue } from "@kalada/core";

/** Copy the readonly host DTO into Kalada's mutable JSON representation without sharing ownership. */
export function kaladaJson(value: JsonValue): KaladaJsonValue {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(kaladaJson);
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, kaladaJson(item)]));
}
