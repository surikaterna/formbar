import { type JsonValue, copyJson } from "@formbar/expressions";
import { KALADA_RUNTIME_ARTIFACT } from "./kalada-artifact.js";
import type { DataContext, FormbarDataStrategyV1 } from "./kalada-data-strategy.js";
import { admitKaladaDefinitionWithPolicy } from "./kalada-definition-policy.js";
import { list, object } from "./kalada-definition-shape.js";
import type { AdmittedDefinition, AdmittedNode } from "./kalada-definition.js";
import { type TrustedDirectLocations, checkPrivateDirectLocation } from "./kalada-direct-location.js";
import { type AdmissionPolicy, type PolicyIdentity, snapshotAdmissionPolicy } from "./kalada-policy.js";
import { components } from "./kalada-private-components.js";
import { checkKaladaOutputFormat409, checkKaladaPresentation409 } from "./kalada-private-presentation-409.js";
import { ProgramAdmissionError } from "./kalada-program.js";
import { validationFieldAliases } from "./kalada-validation-feedback.js";

function ownerFor(admitted: AdmittedDefinition, path: string) {
	let owner: AdmittedNode | undefined;
	for (const node of admitted.nodes.values())
		if (path.startsWith(`${node.path}.`) && (!owner || node.path.length > owner.path.length)) owner = node;
	return owner;
}

export interface PrepareKaladaV1Options {
	readonly definition: unknown;
	readonly policy: unknown;
	readonly identity: PolicyIdentity;
	readonly strategy: FormbarDataStrategyV1;
	/** Trusted host sources, keyed by exact admitted WRITE target path. Not serialized in the definition. */
	readonly writeSources?: Readonly<Record<string, string>>;
	readonly directLocations?: TrustedDirectLocations;
}

export interface PreparedKaladaV1Definition {
	readonly validationFields: ReadonlyMap<string, string>;
	readonly definition: JsonValue;
	readonly admitted: AdmittedDefinition;
	readonly policy: AdmissionPolicy;
	readonly identity: PolicyIdentity;
	readonly context: DataContext;
	readonly strategy: FormbarDataStrategyV1;
	readonly writeSources: Readonly<Record<string, string>>;
	readonly directLocations: TrustedDirectLocations | undefined;
}

function checkInstallation(options: PrepareKaladaV1Options, policy: AdmissionPolicy): DataContext {
	const { strategy, identity } = options;
	if (!strategy || typeof strategy.identity !== "function" || strategy.contract !== "formbar-data-strategy-v1")
		throw new ProgramAdmissionError("root", "MISSING_STRATEGY");
	if (!identity || policy.generation !== identity.generation || policy.fingerprint !== identity.fingerprint)
		throw new ProgramAdmissionError("root", "STALE_POLICY");
	const context = Object.freeze({
		instance: Object.freeze({}),
		policyGeneration: identity.generation,
		policyFingerprint: identity.fingerprint,
	});
	try {
		const installed = strategy.identity(context);
		if (
			installed.artifact !== KALADA_RUNTIME_ARTIFACT ||
			installed.policyGeneration !== identity.generation ||
			installed.policyFingerprint !== identity.fingerprint
		)
			throw new ProgramAdmissionError("root", "STALE_INSTALLATION");
	} catch {
		throw new ProgramAdmissionError("root", "STALE_INSTALLATION");
	}
	return context;
}

function checkTargets(admitted: AdmittedDefinition) {
	for (const path of admitted.targets.keys()) {
		if (path.startsWith("computations[")) continue;
		const node = ownerFor(admitted, path);
		if (node?.type === "repeater" && path === `${node.path}.binding`) continue;
		if (node?.type === "field" && path === `${node.path}.binding`) continue;
		if (node?.type === "validation" && path === `${node.path}.binding`) continue;
		if (node?.type === "action" && path === `${node.path}.target`) continue;
		if (node?.type === "custom" && path.startsWith(`${node.path}.props.`) && path.endsWith(".reference")) continue;
		throw new ProgramAdmissionError(path, "UNSUPPORTED_V1_RE-AUTHOR");
	}
}

function checkNodes(admitted: AdmittedDefinition, definition: JsonValue): void {
	for (const slot of admitted.slots) {
		if (slot.path.startsWith("computations[")) continue;
		if (/\.(visible|disabled|readOnly|condition|required)$/.test(slot.path)) continue;
		const node = ownerFor(admitted, slot.path);
		if (node?.type === "output" && slot.path === `${node.path}.value`) continue;
		if (node?.type === "action" && slot.path === `${node.path}.payload`) continue;
		if (node?.type === "custom" && slot.path.endsWith(".expression")) continue;
		throw new ProgramAdmissionError(slot.path, "UNSUPPORTED_V1_RE-AUTHOR");
	}
	checkTargets(admitted);
	for (const node of admitted.nodes.values()) {
		const root = object(definition, "definition").root;
		if (root === undefined) throw new ProgramAdmissionError("root", "INVALID_NODE_PATH");
		let source: JsonValue = root;
		for (const match of node.path.matchAll(/\.([a-zA-Z]+)\[(\d+)\]/g)) {
			const values = list(object(source, node.path)[match[1] as string], node.path);
			const child = values[Number(match[2])];
			if (child === undefined) throw new ProgramAdmissionError(node.path, "INVALID_NODE_PATH");
			source = child;
		}
		const body = object(source, node.path);
		checkKaladaPresentation409(body.presentation, `${node.path}.presentation`);
		if (node.type === "output") {
			checkKaladaOutputFormat409(body.format, `${node.path}.format`);
			if (body.props !== undefined) throw new ProgramAdmissionError(`${node.path}.props`, "UNSUPPORTED_V1_RE-AUTHOR");
			continue;
		}
		if (node.type === "action") {
			if (body.props !== undefined) throw new ProgramAdmissionError(`${node.path}.props`, "UNSUPPORTED_V1_RE-AUTHOR");
			continue;
		}
		if (
			["group", "section", "field", "repeater", "conditional", "custom", "tabs", "accordion", "validation"].includes(
				node.type,
			)
		)
			continue;
		throw new ProgramAdmissionError(`${node.path}.type`, "UNSUPPORTED_V1_RE-AUTHOR");
	}
}

function checkedWritePaths(admitted: AdmittedDefinition): ReadonlySet<string> {
	const paths = new Set<string>();
	for (const node of admitted.nodes.values()) {
		if (node.type === "field") paths.add(`${node.path}.binding`);
		if (node.type !== "custom") continue;
		for (const path of admitted.targets.keys())
			if (path.startsWith(`${node.path}.props.`) && path.endsWith(".reference")) paths.add(path);
	}
	return paths;
}

function checkWriters(
	options: PrepareKaladaV1Options,
	definition: JsonValue,
	admitted: AdmittedDefinition,
	policy: AdmissionPolicy,
): void {
	const paths = checkedWritePaths(admitted);
	const renderers = components(definition, admitted);
	for (const path of Object.keys(options.writeSources ?? {}))
		if (!paths.has(path)) throw new ProgramAdmissionError(path, "UNKNOWN_WRITER");
	for (const path of paths) {
		const source = options.writeSources?.[path];
		if (typeof source !== "string") throw new ProgramAdmissionError(path, "MISSING_WRITER");
		const proof = checkPrivateDirectLocation(path, source, admitted, options.directLocations);
		if (!proof?.ok) throw new ProgramAdmissionError(path, "UNSUPPORTED_WRITE_TARGET_RE-AUTHOR");
		if (!path.endsWith(".reference")) continue;
		const prop = path.slice(path.lastIndexOf(".props.") + ".props.".length, -".reference".length);
		const owner = ownerFor(admitted, path);
		const renderer = owner && renderers.get(owner.path)?.renderer;
		const expected = renderer && policy.renderers[renderer]?.props[prop]?.expected;
		if (
			!expected ||
			(expected !== "json" && (proof.location.type.kind !== "primitive-type" || proof.location.type.name !== expected))
		)
			throw new ProgramAdmissionError(path, "INVALID_WRITE_TARGET");
	}
}

/** Batch 1: no read, subscription, callback or mutation. Batch 2 consumes this same installed context. */
export function prepareKaladaV1Definition(options: PrepareKaladaV1Options): PreparedKaladaV1Definition {
	if (!options || !options.policy) throw new ProgramAdmissionError("root", "MISSING_POLICY");
	const policy = snapshotAdmissionPolicy(options.policy);
	const context = checkInstallation(options, policy);
	let definition: JsonValue;
	try {
		definition = copyJson(options.definition);
	} catch {
		throw new ProgramAdmissionError("", "INVALID_JSON");
	}
	const admitted = admitKaladaDefinitionWithPolicy(definition, policy, options.identity);
	checkNodes(admitted, definition);
	const submission = object(definition, "definition").submission;
	const omitted = submission && object(submission, "submission").hiddenValues === "omit-inactive";
	if (omitted && (!options.strategy.captureOmission || !options.strategy.submitOmission))
		throw new ProgramAdmissionError("submission.hiddenValues", "OMISSION_STRATEGY_REQUIRED");
	for (const node of admitted.nodes.values())
		if (node.type === "validation" && !options.strategy.captureLifecycle)
			throw new ProgramAdmissionError(`${node.path}.type`, "LIFECYCLE_STRATEGY_REQUIRED");
	if (options.strategy.captureLifecycle && (!options.strategy.validateLifecycle || !options.strategy.resetLifecycle))
		throw new ProgramAdmissionError("root", "LIFECYCLE_STRATEGY_REQUIRED");
	if (!options.strategy.captureSubmission || !options.strategy.submitCaptured)
		throw new ProgramAdmissionError("submission", "SUBMISSION_STRATEGY_REQUIRED");
	if (!options.strategy.writeDirect && checkedWritePaths(admitted).size)
		throw new ProgramAdmissionError("root", "WRITE_STRATEGY_REQUIRED");
	const writeSources = Object.freeze({ ...options.writeSources });
	checkWriters({ ...options, writeSources }, definition, admitted, policy);
	return Object.freeze({
		validationFields: validationFieldAliases(admitted),
		definition,
		admitted,
		policy,
		identity: Object.freeze({ generation: options.identity.generation, fingerprint: options.identity.fingerprint }),
		context,
		strategy: options.strategy,
		writeSources,
		directLocations: options.directLocations,
	});
}
