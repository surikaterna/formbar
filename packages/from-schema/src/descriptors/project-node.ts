import type { OwnedValue, SchemaNode } from "@scheman/core";
import type { DescriptorApplicators, DescriptorNode, DescriptorRef, DescriptorValue } from "./contracts.js";

const ref = (value: { readonly nodeId: string }): DescriptorRef => Object.freeze({ nodeId: value.nodeId });
const refs = (values: readonly { readonly nodeId: string }[]): readonly DescriptorRef[] =>
	Object.freeze(values.map(ref));

export function projectNode(node: SchemaNode): DescriptorNode {
	const common = commonEvidence(node);
	if (node.kind === "unknown" || node.kind === "opaque")
		return Object.freeze({ ...common, kind: node.kind, reason: node.reason });
	if (node.kind === "unconstrained") return Object.freeze({ ...common, kind: node.kind, domain: node.domain });
	if (node.kind === "never") return Object.freeze({ ...common, kind: node.kind });
	if (node.kind === "primitive") return Object.freeze({ ...common, kind: node.kind, type: node.type });
	if (node.kind === "literal")
		return Object.freeze({ ...common, kind: node.kind, value: node.value as DescriptorValue });
	if (node.kind === "enum")
		return Object.freeze({ ...common, kind: node.kind, values: node.values as readonly DescriptorValue[] });
	return projectStructuredNode(node, common);
}

function commonEvidence(node: SchemaNode) {
	return {
		...(node.metadata === undefined ? {} : { metadata: node.metadata as DescriptorValue }),
		...(node.constraints === undefined ? {} : { constraints: node.constraints as DescriptorValue }),
		...(node.applicators === undefined ? {} : { applicators: projectApplicators(node.applicators) }),
	};
}

function projectStructuredNode(node: SchemaNode, common: ReturnType<typeof commonEvidence>): DescriptorNode {
	if (node.kind === "object") return projectObject(node, common);
	if (node.kind === "array") return Object.freeze({ ...common, kind: node.kind, items: ref(node.items) });
	if (node.kind === "tuple")
		return Object.freeze({
			...common,
			kind: node.kind,
			items: refs(node.items),
			...(node.rest ? { rest: ref(node.rest) } : {}),
		});
	if (node.kind === "record")
		return Object.freeze({
			...common,
			kind: node.kind,
			key: ref(node.key),
			value: ref(node.value),
			exhaustive: node.exhaustive,
		});
	if (node.kind === "union")
		return Object.freeze({
			...common,
			kind: node.kind,
			alternatives: refs(node.alternatives),
			semantics: node.semantics,
			...(node.discriminator === undefined ? {} : { discriminator: node.discriminator as DescriptorValue }),
		});
	if (node.kind === "intersection") return Object.freeze({ ...common, kind: node.kind, operands: refs(node.operands) });
	if (node.kind === "ref")
		return Object.freeze({
			...common,
			kind: node.kind,
			reference: node.reference,
			...(node.target ? { target: ref(node.target) } : {}),
			...(node.unresolved === undefined ? {} : { unresolved: node.unresolved }),
		});
	if (node.kind === "wrapper") {
		return Object.freeze({
			...common,
			kind: node.kind,
			wrapper: node.wrapper,
			inner: ref(node.inner),
			...(node.value === undefined ? {} : { value: node.value as DescriptorValue }),
		});
	}
	const fallback = node as { readonly kind: "unknown" | "opaque"; readonly reason: string };
	return Object.freeze({ ...common, kind: fallback.kind, reason: fallback.reason });
}

function projectObject(node: Extract<SchemaNode, { kind: "object" }>, common: object): DescriptorNode {
	return Object.freeze({
		...common,
		kind: node.kind,
		properties: Object.freeze(
			node.properties.map((property) =>
				Object.freeze({
					name: property.name,
					presence: property.presence,
					node: ref(property.node),
				}),
			),
		),
		required: Object.freeze([...node.required]),
		...(node.additionalProperties ? { additionalProperties: ref(node.additionalProperties) } : {}),
		unknownKeys: node.unknownKeys,
	});
}

function projectApplicators(applicators: NonNullable<SchemaNode["applicators"]>): DescriptorApplicators {
	const recordRefs = (values: Readonly<Record<string, { readonly nodeId: string }>> | undefined) =>
		values === undefined
			? undefined
			: (Object.freeze(
					Object.fromEntries(
						Object.keys(values)
							.sort()
							.map((key) => [key, ref(values[key])]),
					),
				) as Readonly<Record<string, DescriptorRef>>);
	return Object.freeze({
		...(applicators.if ? { if: ref(applicators.if) } : {}),
		...(applicators.then ? { then: ref(applicators.then) } : {}),
		...(applicators.else ? { else: ref(applicators.else) } : {}),
		...(applicators.not ? { not: ref(applicators.not) } : {}),
		...(applicators.contains ? { contains: ref(applicators.contains) } : {}),
		...(applicators.propertyNames ? { propertyNames: ref(applicators.propertyNames) } : {}),
		...(applicators.patternProperties
			? { patternProperties: recordRefs(applicators.patternProperties) as Readonly<Record<string, DescriptorRef>> }
			: {}),
		...(applicators.dependentSchemas
			? { dependentSchemas: recordRefs(applicators.dependentSchemas) as Readonly<Record<string, DescriptorRef>> }
			: {}),
	});
}

export const ownedValue = (value: OwnedValue): DescriptorValue => value as DescriptorValue;
