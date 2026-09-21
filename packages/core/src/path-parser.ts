import { FormbarError } from "./errors.js";
import { parseDot } from "./path-dot.js";
import { parsePointer } from "./path-pointer.js";
import type { CanonicalPath, CanonicalSegment, Namespace } from "./path.js";

const DOT_SAFE_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;
const NUMERIC_INDEX_RE = /^(?:0|[1-9]\d*)$/;

const DEFAULT_NAMESPACES: readonly NamespaceConfig[] = [{ prefix: "$ui", namespace: "ui" }];

const PATH_CACHE_MAX = 1000;
const pathCache = new Map<string, CanonicalPath>();

export interface NamespaceConfig {
	/** The prefix string used in paths (e.g. '$ui') */
	readonly prefix: string;
	/** The namespace value it maps to */
	readonly namespace: Namespace;
}

export interface ParsePathOptions {
	/** Recognized namespace prefixes. Defaults to [{ prefix: '$ui', namespace: 'ui' }] */
	readonly namespaces?: readonly NamespaceConfig[];
}

/**
 * Parses a path string into a structured {@link CanonicalPath}.
 * Supports dot notation (`user.name`), JSON Pointer (`/user/name`),
 * and namespace prefixes (`$ui.theme.mode`).
 *
 * @param input - A dot-path, JSON Pointer, or namespaced path string.
 * @param options - Optional parser configuration (custom namespace prefixes).
 * @returns A canonical path with namespace, segments, and format metadata.
 * @throws {@link FormbarError} with code `FORMBAR_PATH_EMPTY` or `FORMBAR_PATH_INVALID_*`.
 *
 * @example
 * ```typescript
 * parsePath("user.address.city");
 * // → { namespace: "data", segments: ["user", "address", "city"], ... }
 *
 * parsePath("$ui.sidebar.collapsed");
 * // → { namespace: "ui", segments: ["sidebar", "collapsed"], ... }
 * ```
 */
export function parsePath(input: string, options?: ParsePathOptions): CanonicalPath {
	const cached = pathCache.get(input);
	if (cached) return cached;

	if (input === "") {
		throw new FormbarError("FORMBAR_PATH_EMPTY", "Path must not be empty");
	}

	const namespaces = options?.namespaces ?? DEFAULT_NAMESPACES;

	// Reject mixed namespace forms like $ui/...
	for (const ns of namespaces) {
		if (input.startsWith(`${ns.prefix}/`)) {
			throw new FormbarError(
				"FORMBAR_PATH_MIXED_NAMESPACE",
				`Mixed namespace form ${ns.prefix}/... is not allowed; use ${ns.prefix}. dot notation`,
			);
		}
	}

	let result: CanonicalPath;
	if (input.startsWith("/")) {
		result = parsePointer(input);
	} else {
		result = parseDot(input, namespaces);
	}

	if (pathCache.size >= PATH_CACHE_MAX) {
		pathCache.clear();
	}
	pathCache.set(input, result);
	return result;
}

/**
 * Converts a {@link CanonicalPath} to a JSON Pointer (RFC 6901) string.
 *
 * @param path - A canonical path object.
 * @returns JSON Pointer string (e.g., `"/user/address/city"`).
 *
 * @example
 * ```typescript
 * toPointer(parsePath("user.name")); // "/user/name"
 * ```
 */
export function toPointer(path: CanonicalPath): string {
	if (path.namespace === "ui") {
		throw new FormbarError("FORMBAR_PATH_MIXED_NAMESPACE", "Cannot convert ui-namespace path to JSON Pointer");
	}
	return `/${path.segments.map(encodePointerSegment).join("/")}`;
}

function encodePointerSegment(seg: CanonicalSegment): string {
	const s = String(seg);
	return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Converts a {@link CanonicalPath} back to dot notation string.
 *
 * @param path - A canonical path object.
 * @returns Dot-delimited string (e.g., `"user.address.city"`).
 * @throws {@link FormbarError} with `FORMBAR_PATH_NOT_DOT_SAFE` if a segment cannot be represented in dot notation.
 *
 * @example
 * ```typescript
 * toDot(parsePath("user.name")); // "user.name"
 * ```
 */
export function toDot(path: CanonicalPath): string {
	for (const seg of path.segments) {
		const s = String(seg);
		if (!DOT_SAFE_SEGMENT_RE.test(s)) {
			throw new FormbarError(
				"FORMBAR_PATH_NOT_DOT_SAFE",
				`Segment "${s}" contains characters not representable in dot notation`,
			);
		}
		if (typeof seg === "string" && NUMERIC_INDEX_RE.test(seg)) {
			throw new FormbarError(
				"FORMBAR_PATH_NOT_DOT_SAFE",
				`String segment "${seg}" is ambiguous in dot notation (looks numeric)`,
			);
		}
	}

	const dotPath = path.segments.map(String).join(".");
	return path.namespace === "ui" ? `$ui.${dotPath}` : dotPath;
}
