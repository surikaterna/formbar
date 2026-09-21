import type { ProjectionDiagnostic, SourceDiagnostic } from "../diagnostics.js";

export type DescriptorSide = "input" | "output";
export type DescriptorAvailability = "complete" | "partial" | "unavailable";
export type DescriptorValue = null | boolean | number | string | readonly DescriptorValue[] | DescriptorValueRecord;
export interface DescriptorValueRecord {
	readonly [key: string]: DescriptorValue;
}

export type DescriptorPrimitive =
	| "string"
	| "number"
	| "integer"
	| "boolean"
	| "null"
	| "undefined"
	| "void"
	| "bigint"
	| "symbol"
	| "date"
	| "NaN";

export interface DescriptorRef {
	readonly nodeId: string;
}

export interface DescriptorProperty {
	readonly name: string;
	readonly presence: "required" | "optional" | "unknown";
	readonly node: DescriptorRef;
}

export interface DescriptorApplicators {
	readonly if?: DescriptorRef;
	readonly then?: DescriptorRef;
	readonly else?: DescriptorRef;
	readonly not?: DescriptorRef;
	readonly contains?: DescriptorRef;
	readonly propertyNames?: DescriptorRef;
	readonly patternProperties?: Readonly<Record<string, DescriptorRef>>;
	readonly dependentSchemas?: Readonly<Record<string, DescriptorRef>>;
}

export interface DescriptorCommon {
	readonly metadata?: DescriptorValue;
	readonly constraints?: DescriptorValue;
	readonly applicators?: DescriptorApplicators;
}

export type DescriptorNode = DescriptorCommon &
	(
		| { readonly kind: "unknown" | "opaque"; readonly reason: string }
		| { readonly kind: "unconstrained"; readonly domain: "json" | "js" }
		| { readonly kind: "never" }
		| { readonly kind: "primitive"; readonly type: DescriptorPrimitive }
		| { readonly kind: "literal"; readonly value: DescriptorValue }
		| { readonly kind: "enum"; readonly values: readonly DescriptorValue[] }
		| {
				readonly kind: "object";
				readonly properties: readonly DescriptorProperty[];
				readonly required: readonly string[];
				readonly additionalProperties?: DescriptorRef;
				readonly unknownKeys: "strip" | "reject" | "passthrough" | "schema" | "unknown";
		  }
		| { readonly kind: "array"; readonly items: DescriptorRef }
		| { readonly kind: "tuple"; readonly items: readonly DescriptorRef[]; readonly rest?: DescriptorRef }
		| {
				readonly kind: "record";
				readonly key: DescriptorRef;
				readonly value: DescriptorRef;
				readonly exhaustive: boolean | "unknown";
		  }
		| {
				readonly kind: "union";
				readonly alternatives: readonly DescriptorRef[];
				readonly semantics: "anyOf" | "oneOf" | "zod";
				readonly discriminator?: DescriptorValue;
		  }
		| { readonly kind: "intersection"; readonly operands: readonly DescriptorRef[] }
		| {
				readonly kind: "ref";
				readonly reference: string;
				readonly target?: DescriptorRef;
				readonly unresolved?: string;
		  }
		| {
				readonly kind: "wrapper";
				readonly wrapper:
					| "optional"
					| "nullable"
					| "default"
					| "catch"
					| "readonly"
					| "brand"
					| "pipeline"
					| "effect"
					| "coerce";
				readonly inner: DescriptorRef;
				readonly value?: DescriptorValue;
		  }
	);

export type OccurrencePathSegment = string | number | "*";
export type OccurrenceRelation =
	| "root"
	| "property"
	| "items"
	| "tuple-item"
	| "tuple-rest"
	| "record-key"
	| "record-value"
	| "alternative"
	| "operand"
	| "reference"
	| "wrapper"
	| "additional-properties"
	| "applicator";

export interface DescriptorOccurrence {
	readonly id: string;
	readonly nodeId: string;
	readonly path: readonly OccurrencePathSegment[];
	readonly relation: OccurrenceRelation;
	readonly key?: string | number;
	readonly presence?: "required" | "optional" | "unknown";
	readonly expansion: "expanded" | "cycle" | "limit" | "missing";
	readonly shared: boolean;
	readonly children: readonly string[];
}

export interface DescriptorDefinition {
	readonly name?: string;
	readonly sourcePointer: string;
	readonly nodeId: string;
	readonly occurrenceId?: string;
}

export interface NormalizedEvidence {
	readonly primitive?: DescriptorPrimitive;
	readonly presence?: "required" | "optional" | "unknown";
	readonly literal?: DescriptorValue;
	readonly enum?: readonly DescriptorValue[];
	readonly default?: DescriptorValue;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly exclusiveMinimum?: number;
	readonly exclusiveMaximum?: number;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly pattern?: string;
	readonly format?: string;
}

export interface DescriptorSource {
	readonly provider: string;
	readonly side: DescriptorSide;
	readonly availability: DescriptorAvailability;
	readonly capabilities: Readonly<Record<DescriptorSide, DescriptorAvailability>>;
	readonly metadata: DescriptorValue;
}

export interface DescriptorDocument {
	readonly formatVersion: 1;
	readonly source: DescriptorSource;
	readonly rootOccurrenceId: string;
	readonly nodes: Readonly<Record<string, DescriptorNode>>;
	readonly occurrences: Readonly<Record<string, DescriptorOccurrence>>;
	readonly definitions: readonly DescriptorDefinition[];
	readonly evidence: Readonly<Record<string, NormalizedEvidence>>;
	readonly sourceDiagnostics: readonly SourceDiagnostic[];
	readonly projectionDiagnostics: readonly ProjectionDiagnostic[];
}
