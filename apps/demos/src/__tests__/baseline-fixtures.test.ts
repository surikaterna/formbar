import type { FormNode } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { describe, expect, it } from "vitest";
import { baselineFixtures } from "../demos/index";

const provider = jsonSchemaProvider({ dialect: "draft-2020-12" });

function compile(fixtureId: string, sourceKey = "default") {
	const fixture = baselineFixtures.find((candidate) => candidate.id === fixtureId);
	const source = fixture?.sources.find((candidate) => candidate.key === sourceKey) ?? fixture?.sources[0];
	if (!source) throw new Error(`Missing fixture ${fixtureId}:${sourceKey}`);
	return createSchemaForm(source.schema, {
		provider,
		side: "input",
		...(source.definition || source.definitionVariants
			? { definition: source.definition ?? source.definitionVariants?.[0].definition }
			: {}),
	});
}

function nodes(node: FormNode): readonly FormNode[] {
	const children = node.type === "group" || node.type === "section" || node.type === "repeater" ? node.children : [];
	return [node, ...children.flatMap(nodes)];
}

function evidenceAt(result: ReturnType<typeof compile>, ...path: string[]) {
	const occurrences = Object.values(result.descriptors.occurrences).filter(
		(candidate) =>
			candidate.path.length === path.length && candidate.path.every((segment, index) => segment === path[index]),
	);
	if (occurrences.length === 0) throw new Error(`Missing descriptor at ${path.join(".")}`);
	return Object.assign({}, ...occurrences.map((occurrence) => result.descriptors.evidence[occurrence.nodeId]));
}

describe("baseline demo fixtures", () => {
	it("compiles every source without invalid definitions or lossy field diagnostics", () => {
		for (const fixture of baselineFixtures) {
			for (const source of fixture.sources) {
				const result = compile(fixture.id, source.key);
				expect(result.diagnostics.definition, fixture.id).toEqual([]);
				expect(
					result.diagnostics.compilation.every(
						(diagnostic) => diagnostic.code === "unsupported-schema" && diagnostic.message.includes("dynamic-property"),
					),
					fixture.id,
				).toBe(true);
				expect(
					nodes(result.definition.root).filter((node) => node.type === "field" && node.widget === "unsupported"),
				).toEqual([]);
			}
		}
	});

	it("renders demos 1 and 3 with required fields, widgets, nested titles, and options", () => {
		const contact = compile("basic-contact");
		const contactNodes = nodes(contact.definition.root);
		expect(contactNodes.find((node) => node.type === "field" && node.widget === "textarea")).toBeDefined();
		expect(contact.baseline.filter((item) => item.required).map((item) => item.label)).toEqual(["Full Name", "Email"]);
		expect(evidenceAt(contact, "name").minLength).toBe(1);
		expect(baselineFixtures.find((fixture) => fixture.id === "basic-contact")?.copy).toContain(
			"requires name and email properties; minLength separately",
		);
		const addresses = compile("nested-address");
		expect(
			nodes(addresses.definition.root)
				.filter((node) => node.type === "section")
				.map((node) => "title" in node && node.title),
		).toEqual(["Home Address", "Work Address"]);
		expect(evidenceAt(addresses, "homeAddress", "country").enum).toContain("United Kingdom");
		expect(evidenceAt(addresses, "workAddress", "country").enum).toContain("Japan");
	});

	it("retains schema options, numeric bounds, integer evidence, and requiredness", () => {
		expect(evidenceAt(compile("user-profile"), "age")).toMatchObject({
			primitive: "integer",
			minimum: 18,
			maximum: 120,
		});
		expect(evidenceAt(compile("settings-panel"), "fontSize")).toMatchObject({ minimum: 12, maximum: 24 });
		expect(evidenceAt(compile("product-entry"), "rating")).toMatchObject({
			primitive: "integer",
			minimum: 1,
			maximum: 5,
		});
		expect(evidenceAt(compile("custom-layout"), "vesselType").enum).toEqual([
			"Container",
			"Bulk Carrier",
			"Tanker",
			"RoRo",
			"General Cargo",
		]);
		const kitchen = compile("kitchen-sink");
		expect(kitchen.baseline.find((item) => item.nodeId === "f-required")?.required).toBe(true);
		expect(evidenceAt(kitchen, "sliderField")).toMatchObject({ primitive: "integer", minimum: 0, maximum: 100 });
	});

	it("retains authored section order and responsive spans", () => {
		const layout = compile("custom-layout");
		expect(
			nodes(layout.definition.root)
				.filter((node) => node.type === "section")
				.map((node) => "title" in node && node.title),
		).toEqual(["Vessel Identity", "Classification", "Dimensions & Capacity"]);
		const responsive = compile("multi-section-responsive");
		const firstName = nodes(responsive.definition.root).find((node) => node.id === "f-first");
		expect(firstName?.presentation?.span).toEqual({ base: "full", md: 6 });
	});

	it("compiles both JSON Schema detail levels through the shared host contract", () => {
		const minimal = compile("multi-schema-sources", "minimal");
		const explicit = compile("multi-schema-sources", "explicit");
		expect(nodes(minimal.definition.root).find((node) => node.type === "field")?.label).toBe("name");
		expect(nodes(explicit.definition.root).find((node) => node.type === "field")?.label).toBe("Full Name");
	});
});
