import type { ScopedFieldIssueInput } from "@formbar/core/internal/scoped-sync";
import { inspectDataContainer } from "@formbar/expressions";
import type { ConcreteOwner } from "./runtime-ownership.js";

const unsafe = new Set(["__proto__", "constructor", "prototype"]);

function existing(root: unknown, segments: readonly (string | number)[]): unknown {
	let value = root;
	try {
		for (const segment of segments) {
			if (value === null || typeof value !== "object") return undefined;
			if (Array.isArray(value) !== (typeof segment === "number")) return undefined;
			if (typeof segment === "string" && (!segment || unsafe.has(segment))) return undefined;
			if (typeof segment === "number" && (!Number.isSafeInteger(segment) || segment < 0)) return undefined;
			const entries = new Map(inspectDataContainer(value));
			if (!entries.has(String(segment))) return undefined;
			value = entries.get(String(segment));
		}
		return value;
	} catch {
		return undefined;
	}
}

/** Issue-target proof only; never changes omission eligibility or unknown bindings. */
export function certifyScopedOutput(
	root: unknown,
	owner: ConcreteOwner,
	output: readonly ScopedFieldIssueInput[],
	invalid = "Invalid scoped field issue",
): readonly ScopedFieldIssueInput[] {
	if (!Array.isArray(output)) throw new Error(invalid);
	for (const issue of output) {
		if (!issue || typeof issue !== "object") throw new Error(invalid);
		if (issue.descendant === undefined) {
			if (!owner.eligible) throw new Error(invalid);
			continue;
		}
		if (
			!Array.isArray(issue.descendant) ||
			!issue.descendant.length ||
			existing(root, [...owner.binding.segments, ...issue.descendant]) === undefined
		)
			throw new Error(invalid);
	}
	return output;
}

export function sourceBound(root: unknown, owner: ConcreteOwner): boolean {
	const value = existing(root, owner.binding.segments);
	return (
		!owner.protected &&
		owner.binding.namespace === "data" &&
		owner.binding.segments.length > 0 &&
		value !== null &&
		typeof value === "object"
	);
}
