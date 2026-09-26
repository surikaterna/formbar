import { ownIssue } from "./issue-ownership.js";
import type { CanonicalSegment } from "./path.js";
import type { FormStateCapture, ValidationIssue } from "./state.js";

interface Certificate {
	readonly id: number;
	readonly fieldId: string;
	readonly instanceKey: string;
	readonly binding: readonly CanonicalSegment[];
	readonly revision: number;
	readonly run: object;
	readonly current: () => boolean;
	readonly issue: ValidationIssue;
	readonly capture?: FormStateCapture<unknown, unknown>;
	readonly ownership?: object;
}

const certificates = new WeakMap<ValidationIssue, Certificate>();
let nextId = 0;

/** Origin matching may evict an expired producer emission without treating it as live. */
export function wasIssueEmission(issue: ValidationIssue): boolean {
	return certificates.has(issue);
}

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
	readonly capture?: FormStateCapture<unknown, unknown>;
	readonly ownership?: object;
	readonly current: () => boolean;
	readonly signal?: AbortSignal;
	readonly asyncValidatorId?: string;
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
			source: options.asyncValidatorId
				? { origin: "async-validator", validatorId: options.asyncValidatorId }
				: { origin: "function-validator", validatorId: options.fieldId },
		});
		certificates.set(issue, {
			id: ++nextId,
			fieldId: options.fieldId,
			instanceKey: options.instanceKey,
			binding,
			revision: options.revision,
			run: options.run,
			...(options.capture ? { capture: options.capture } : {}),
			...(options.ownership ? { ownership: options.ownership } : {}),
			current: valid,
			issue,
		});
		return issue;
	};
}

/** Only original emissions from this exact projected capture may be associated with its owner. */
export function issueSourceAtCapture(
	issue: ValidationIssue,
	ownership: object,
): Readonly<Pick<Certificate, "fieldId" | "instanceKey" | "binding" | "capture">> | undefined {
	const certificate = certificates.get(issue);
	if (!certificate || certificate.issue !== issue || certificate.ownership !== ownership) return undefined;
	try {
		return certificate.current() ? certificate : undefined;
	} catch {
		return undefined;
	}
}

export function issueProductionOwnership(issue: ValidationIssue): object | undefined {
	const certificate = certificates.get(issue);
	if (!certificate?.ownership || certificate.issue !== issue) return undefined;
	try {
		return certificate.current() ? certificate.ownership : undefined;
	} catch {
		return undefined;
	}
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
