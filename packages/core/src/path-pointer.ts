import { FormbarError } from "./errors.js";
import type { CanonicalPath, CanonicalSegment } from "./path.js";

export function parsePointer(input: string): CanonicalPath {
	const parts = input.split("/");
	const rawSegments = parts.slice(1);
	const segments: CanonicalSegment[] = rawSegments.map(decodePointerSegment);
	return { namespace: "data", segments };
}

function decodePointerSegment(raw: string): CanonicalSegment {
	validatePointerEscapes(raw);
	return raw.replace(/~1/g, "/").replace(/~0/g, "~");
}

function validatePointerEscapes(raw: string): void {
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === "~") {
			const next = raw[i + 1];
			if (next !== "0" && next !== "1") {
				throw new FormbarError(
					"FORMBAR_PATH_INVALID_POINTER_ESCAPE",
					`Invalid JSON Pointer escape sequence ~${next ?? ""} at index ${i}`,
				);
			}
		}
	}
}
