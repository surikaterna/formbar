import { KALADA_RUNTIME_ARTIFACT } from "./kalada-artifact.js";
import type { PolicyIdentity } from "./kalada-policy.js";

const keys = ["artifact", "policyGeneration", "policyFingerprint"] as const;

/** Inspect the complete receipt before consuming any field; identity is metadata, not an evaluator. */
export function installationIdentityMatches(input: unknown, identity: PolicyIdentity): boolean {
	try {
		if (!input || typeof input !== "object" || Array.isArray(input)) return false;
		const prototype: unknown = Object.getPrototypeOf(input);
		if (prototype !== null && prototype !== Object.prototype) return false;
		const names = Reflect.ownKeys(input);
		if (names.length !== keys.length || names.some((name) => !keys.some((key) => key === name))) return false;
		const values = new Map<string, string>();
		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(input, key);
			if (!descriptor || !("value" in descriptor)) return false;
			const value: unknown = descriptor.value;
			if (typeof value !== "string" || !value.length || value.length > 2048) return false;
			values.set(key, value);
		}
		return (
			values.get("artifact") === KALADA_RUNTIME_ARTIFACT &&
			values.get("policyGeneration") === identity.generation &&
			values.get("policyFingerprint") === identity.fingerprint
		);
	} catch {
		return false;
	}
}
