import { ownIssue } from "./issue-ownership.js";
import type { CanonicalSegment } from "./path.js";
import type { ValidationIssue } from "./state.js";

interface Certificate {
	readonly id: number;
	readonly fieldId: string;
	readonly instanceKey: string;
	readonly binding: readonly CanonicalSegment[];
	readonly revision: number;
	readonly run: object;
	readonly current: () => boolean;
	readonly issue: ValidationIssue;
}

const certificates = new WeakMap<ValidationIssue, Certificate>();
let nextId = 0;

function safeSegments(segments: readonly CanonicalSegment[]): boolean {
	return segments.every((segment) =>
		typeof segment === "number"
			? Number.isSafeInteger(segment) && segment >= 0
			: !!segment && !["__proto__", "constructor", "prototype"].includes(segment),
	);
}

/** Internal producer seam: only a host holding a validated concrete binding may construct a dispatcher. */
export function createIssueEmission(options: {
	readonly fieldId: string;
	readonly instanceKey: string;
	readonly binding: { readonly namespace: "data"; readonly segments: readonly CanonicalSegment[] };
	readonly revision: number;
	readonly run: object;
	readonly current: () => boolean;
	readonly signal?: AbortSignal;
}) {
	const binding = Object.freeze([...options.binding.segments]);
	const valid = () => {
		try {
			return !options.signal?.aborted && options.current();
		} catch {
			return false;
		}
	};
	return (
		input: Pick<ValidationIssue, "code" | "message" | "severity" | "stage"> & {
			readonly descendant?: readonly CanonicalSegment[];
		},
	): ValidationIssue => {
		const descendant = input.descendant ?? [];
		if (
			!valid() ||
			!options.fieldId ||
			!options.instanceKey ||
			binding.length === 0 ||
			!safeSegments([...binding, ...descendant])
		) {
			throw new Error("Unsafe or stale scoped issue emission");
		}
		const issue: ValidationIssue = ownIssue({
			code: input.code,
			message: input.message,
			severity: input.severity,
			...(input.stage === undefined ? {} : { stage: input.stage }),
			path: { namespace: "data", segments: [...binding, ...descendant] },
			source: { origin: "function-validator", validatorId: options.fieldId },
		});
		certificates.set(issue, {
			id: ++nextId,
			fieldId: options.fieldId,
			instanceKey: options.instanceKey,
			binding,
			revision: options.revision,
			run: options.run,
			current: valid,
			issue,
		});
		return issue;
	};
}

/** A copied, rehydrated, superseded or aborted issue is never certified. */
export function issueCertificate(
	issue: ValidationIssue,
	revision: number,
	run: object,
): Readonly<Certificate> | undefined {
	const certificate = certificates.get(issue);
	return certificate?.issue === issue &&
		certificate.revision === revision &&
		certificate.run === run &&
		certificate.current()
		? certificate
		: undefined;
}

/** Dedupe must keep every live certified emission separate from unowned diagnostics. */
export function issueEmissionId(issue: ValidationIssue): number | undefined {
	const certificate = certificates.get(issue);
	return certificate?.issue === issue && certificate.current() ? certificate.id : undefined;
}
