import type { JsonValue, KaladaV1Host, SchemaValidatorV1 } from "@formbar/declarative";
import { arbiterDynamicSectionsDemo } from "../../../apps/demos/src/demos/21-arbiter-dynamic-sections";
import { literal } from "../../../apps/demos/src/demos/kalada-fixture-programs";
import type { PlaygroundDocument } from "../../../apps/demos/src/playground/contracts";
import { disposeDemoSession, installDemoSession } from "../../../apps/demos/src/runtime/kalada-demo-install";
import { managedFieldPolicies } from "../../../apps/demos/src/runtime/kalada-demo-managed-policy";

type Options = {
	enforced?: boolean;
	locked?: boolean;
	missing?: boolean;
	schemaFailure?: boolean;
	omit?: boolean;
	profiles?: readonly string[];
	previous?: KaladaV1Host;
};
type Node = Record<string, unknown>;
export const sectionIds = Object.fromEntries(
	["coverageType", "make", "model", "year", "address", "sqft", "yearBuilt", "age", "smoker", "conditions"].map(
		(name) => [name, name === "coverageType" ? "f-coverage-type" : name === "yearBuilt" ? "f-year-built" : `f-${name}`],
	),
);
const branches: Record<string, readonly string[]> = {
	auto: ["make", "model", "year"],
	home: ["address", "sqft", "yearBuilt"],
	life: ["age", "smoker", "conditions"],
};

function selectedRequired(calls: JsonValue[]): SchemaValidatorV1 {
	return (data) => {
		calls.push(structuredClone(data));
		if (!data || typeof data !== "object" || Array.isArray(data)) return [];
		const values = data as Readonly<Record<string, JsonValue>>;
		return (branches[String(values.coverageType)] ?? []).flatMap((name) => {
			const value = values[name];
			return value === undefined || value === null || (typeof value === "string" && !value.trim())
				? [{ path: [name], message: `Selected ${name} is required.`, source: "extension" as const }]
				: [];
		});
	};
}

function child(node: Node, branch: string, index: number) {
	const value = (node[branch] as readonly Node[])[index];
	if (!value) throw new Error("Missing demo21 fixture branch");
	return value;
}

function sectionsDocument(options: Options) {
	const source = arbiterDynamicSectionsDemo.sources[0];
	const definition = structuredClone(source.definition) as unknown as Node;
	const rules = structuredClone(source.arbiterRules);
	const auto = child(child(child(definition.root as Node, "children", 1), "then", 0), "then", 0).children as Node[];
	const policy = rules[0].then[0].$set as unknown as Record<string, Node>;
	if (options.locked) {
		auto[0].readOnly = literal(true);
		policy["$formbar.fieldPolicy.make"].readOnly = false;
		policy["$formbar.fieldPolicy.model"].disabled = true;
		policy["$formbar.fieldPolicy.year"].readOnly = true;
	}
	if (options.missing)
		auto[0].required = {
			format: "kalada-program",
			version: 1,
			profile: "kalada-v1",
			expression: { kind: "ref", ref: { namespace: "ui", segments: ["fieldRequired:missing"] } },
		};
	if (options.omit) definition.submission = { hiddenValues: "omit-inactive" };
	const schema = structuredClone(source.schema) as unknown as Node;
	if (options.schemaFailure) (schema.properties as Record<string, Node>).make.minLength = 3;
	const document = {
		version: 2,
		schema,
		definition,
		initialData: structuredClone(source.initialData),
	} as PlaygroundDocument;
	return { document, rules };
}

export function sectionsFixture(options: Options = {}) {
	const { document, rules } = sectionsDocument(options);
	const calls: JsonValue[] = [];
	const submitted: Readonly<Record<string, unknown>>[] = [];
	const profiles = options.profiles ?? ["formbar.standard.v1", "formbar.arbiter.v1"];
	const host = installDemoSession(document, (data) => submitted.push(data), profiles, options.previous, {}, rules, {
		validators: options.enforced ? [selectedRequired(calls)] : [],
	});
	return {
		host,
		calls,
		submitted,
		managed: managedFieldPolicies(rules),
		document,
		ids: sectionIds,
		write(name: string, value: unknown) {
			return (
				host
					.snapshot()
					.controls.find((control) => control.nodeId === sectionIds[name])
					?.writers.value?.(value) ?? { status: "denied" }
			);
		},
		replace(nextProfiles = profiles) {
			return sectionsFixture({ ...options, previous: host, profiles: nextProfiles });
		},
		dispose() {
			disposeDemoSession(host);
		},
	};
}
