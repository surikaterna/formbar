import type {
	DescriptorNode,
	DescriptorPrimitive,
	DescriptorValue,
	DescriptorValueRecord,
	NormalizedEvidence,
} from "./contracts.js";

type EvidenceKey = Exclude<keyof NormalizedEvidence, "primitive" | "literal" | "enum" | "default" | "presence">;
type CandidateMap = Partial<Record<EvidenceKey, (number | string)[]>>;

export function normalizedEvidence(node: DescriptorNode): NormalizedEvidence {
	const constraints = record(node.constraints);
	const annotations = childRecord(node.metadata, "annotations");
	const candidates: CandidateMap = {};
	collectDirectConstraints(constraints, candidates);
	collectZodConstraints(node, constraints, candidates);
	const primitive = normalizedPrimitive(node, constraints);
	const defaultValue = defaultEvidence(node, annotations);
	return Object.freeze({
		...(primitive ? { primitive } : {}),
		...(node.kind === "literal" ? { literal: node.value } : {}),
		...(node.kind === "enum" ? { enum: node.values } : {}),
		...(defaultValue === undefined ? {} : { default: defaultValue }),
		...unambiguousCandidates(candidates),
	});
}

function collectDirectConstraints(source: DescriptorValueRecord | undefined, output: CandidateMap): void {
	for (const key of [
		"minimum",
		"maximum",
		"exclusiveMinimum",
		"exclusiveMaximum",
		"minLength",
		"maxLength",
		"minItems",
		"maxItems",
	] as const)
		addNumber(output, key, source?.[key]);
	addString(output, "pattern", source?.pattern);
	addString(output, "format", source?.format);
}

function collectZodConstraints(
	node: DescriptorNode,
	source: DescriptorValueRecord | undefined,
	output: CandidateMap,
): void {
	if (node.kind === "array") {
		addNumber(output, "minItems", constraintValue(source?.minLength));
		addNumber(output, "maxItems", constraintValue(source?.maxLength));
		addExactLength(node, output, constraintValue(source?.exactLength));
	}
	const checks = Array.isArray(source?.checks) ? source.checks : [];
	for (const value of checks) {
		const check = record(value);
		if (check) collectZodCheck(node, check, output);
	}
}

function collectZodCheck(node: DescriptorNode, check: DescriptorValueRecord, output: CandidateMap): void {
	const kind = typeof check.kind === "string" ? check.kind : check.check;
	if (kind === "min" || kind === "max") collectZod3Bound(node, check, output, kind);
	if (kind === "min_length" || kind === "min_size") addLengthBound(node, output, true, check.minimum);
	if (kind === "max_length" || kind === "max_size") addLengthBound(node, output, false, check.maximum);
	if (kind === "length") addExactLength(node, output, check.value);
	if (kind === "length_equals") addExactLength(node, output, check.length);
	if (kind === "size_equals") addExactLength(node, output, check.size);
	if (kind === "greater_than" || kind === "less_than") collectZod4Bound(check, output, kind);
	if (kind === "regex") addPattern(output, check.regex);
	if (kind === "string_format") collectStringFormat(check, output);
	if (typeof kind === "string" && FORMAT_KINDS.has(kind)) addString(output, "format", kind);
}

function collectZod3Bound(
	node: DescriptorNode,
	check: DescriptorValueRecord,
	output: CandidateMap,
	kind: "min" | "max",
): void {
	if (node.kind === "primitive" && node.type === "string") {
		addNumber(output, kind === "min" ? "minLength" : "maxLength", check.value);
		return;
	}
	if (node.kind === "array") {
		addNumber(output, kind === "min" ? "minItems" : "maxItems", check.value);
		return;
	}
	const exclusive = check.inclusive === false;
	addNumber(output, boundKey(kind, exclusive), check.value);
}

function addLengthBound(
	node: DescriptorNode,
	output: CandidateMap,
	minimum: boolean,
	value: DescriptorValue | undefined,
): void {
	if (node.kind === "array") {
		addNumber(output, minimum ? "minItems" : "maxItems", value);
		return;
	}
	if (node.kind === "primitive" && node.type === "string") {
		addNumber(output, minimum ? "minLength" : "maxLength", value);
	}
}

function addExactLength(node: DescriptorNode, output: CandidateMap, value: DescriptorValue | undefined): void {
	addLengthBound(node, output, true, value);
	addLengthBound(node, output, false, value);
}

function collectZod4Bound(
	check: DescriptorValueRecord,
	output: CandidateMap,
	kind: "greater_than" | "less_than",
): void {
	const minimum = kind === "greater_than";
	addNumber(output, boundKey(minimum ? "min" : "max", check.inclusive === false), check.value);
}

function collectStringFormat(check: DescriptorValueRecord, output: CandidateMap): void {
	if (check.format === "regex") {
		addPattern(output, check.pattern);
		return;
	}
	addString(output, "format", check.format);
}

function normalizedPrimitive(
	node: DescriptorNode,
	constraints: DescriptorValueRecord | undefined,
): DescriptorPrimitive | undefined {
	if (node.kind !== "primitive") return undefined;
	const checks = Array.isArray(constraints?.checks) ? constraints.checks : [];
	const integer = checks.some((value) => {
		const check = record(value);
		return check?.kind === "int" || (check?.check === "number_format" && check.format === "safeint");
	});
	return integer ? "integer" : node.type;
}

function defaultEvidence(
	node: DescriptorNode,
	annotations: DescriptorValueRecord | undefined,
): DescriptorValue | undefined {
	if (node.kind === "wrapper" && node.wrapper === "default" && node.value !== undefined) {
		return isDeferredDefault(node.value) ? undefined : node.value;
	}
	return annotations?.default;
}

function isDeferredDefault(value: DescriptorValue): boolean {
	const marker = record(value);
	return marker?.status === "deferred" && marker.kind === "default";
}

function addPattern(output: CandidateMap, value: DescriptorValue | undefined): void {
	const pattern = record(value);
	if (pattern?.$type === "regexp" && pattern.flags === "") addString(output, "pattern", pattern.source);
}

function addNumber(output: CandidateMap, key: EvidenceKey, value: DescriptorValue | undefined): void {
	if (typeof value !== "number" || !Number.isFinite(value)) return;
	const candidates = output[key] ?? [];
	candidates.push(value);
	output[key] = candidates;
}

function addString(output: CandidateMap, key: EvidenceKey, value: DescriptorValue | undefined): void {
	if (typeof value !== "string") return;
	const candidates = output[key] ?? [];
	candidates.push(value);
	output[key] = candidates;
}

function unambiguousCandidates(input: CandidateMap): Partial<NormalizedEvidence> {
	const output: Record<string, number | string> = {};
	for (const [key, values] of Object.entries(input)) {
		if (!values || values.length === 0) continue;
		if (values.every((value): value is number => typeof value === "number")) {
			output[key] = restrictiveBound(key as EvidenceKey, values);
		} else if (values.every((value) => value === values[0])) output[key] = values[0];
	}
	collapseNumericBound(output, "minimum", "exclusiveMinimum", true);
	collapseNumericBound(output, "maximum", "exclusiveMaximum", false);
	return output;
}

function restrictiveBound(key: EvidenceKey, values: readonly number[]): number {
	let selected = values[0];
	for (const value of values.slice(1))
		selected = UPPER_BOUND_KEYS.has(key) ? Math.min(selected, value) : Math.max(selected, value);
	return selected;
}

function collapseNumericBound(
	output: Record<string, number | string>,
	inclusiveKey: "minimum" | "maximum",
	exclusiveKey: "exclusiveMinimum" | "exclusiveMaximum",
	lower: boolean,
): void {
	const inclusive = output[inclusiveKey];
	const exclusive = output[exclusiveKey];
	if (typeof inclusive !== "number" || typeof exclusive !== "number") return;
	const exclusiveWins = lower ? exclusive >= inclusive : exclusive <= inclusive;
	delete output[exclusiveWins ? inclusiveKey : exclusiveKey];
}

function boundKey(kind: "min" | "max", exclusive: boolean): EvidenceKey {
	if (kind === "min") return exclusive ? "exclusiveMinimum" : "minimum";
	return exclusive ? "exclusiveMaximum" : "maximum";
}

function childRecord(value: unknown, key: string): DescriptorValueRecord | undefined {
	return record(record(value)?.[key]);
}

function constraintValue(value: DescriptorValue | undefined): DescriptorValue | undefined {
	return typeof value === "number" ? value : record(value)?.value;
}

function record(value: unknown): DescriptorValueRecord | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as DescriptorValueRecord)
		: undefined;
}

const FORMAT_KINDS = new Set(["email", "url", "uuid", "cuid", "datetime", "date", "time", "duration", "ip", "emoji"]);
const UPPER_BOUND_KEYS = new Set<EvidenceKey>(["maximum", "exclusiveMaximum", "maxLength", "maxItems"]);
