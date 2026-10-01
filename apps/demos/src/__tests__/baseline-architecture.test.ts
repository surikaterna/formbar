import { describe, expect, it } from "vitest";

import host from "../renderers/SchemaDemoHost.tsx?raw";
import runtime from "../renderers/SchemaFormRuntime.tsx?raw";
import installation from "../renderers/use-demo-installation.ts?raw";
import installer from "../runtime/kalada-demo-install.ts?raw";
import strategy from "../runtime/kalada-demo-strategy.ts?raw";

const fixtureModules = import.meta.glob(
	"../demos/{01-basic-contact,02-user-profile,03-nested-address,04-settings-panel,05-product-entry,09-custom-layout,10-multi-section-responsive,13-multi-schema-sources,15-kitchen-sink}.ts",
	{ query: "?raw", import: "default", eager: true },
) as Readonly<Record<string, string>>;

describe("baseline demo architecture", () => {
	it("keeps fixtures free of React and app-owned rendering or binding", () => {
		const fixtures = Object.values(fixtureModules).join("\n");
		expect(Object.keys(fixtureModules)).toHaveLength(9);
		expect(fixtures).not.toMatch(/from ["']react|DemoFormRoot|DemoFormField|ArrayRenderer/);
		expect(fixtures).not.toMatch(
			/useFormSelector|useField|fieldDynamic|Object\.(keys|values|entries)\([^)]*properties/,
		);
		expect(fixtures).not.toMatch(/<(?:input|select|textarea|form)\b/);
	});

	it("uses one installed V1 host path with keyed source-selection chrome", () => {
		expect(host).not.toContain("useSchemaForm");
		expect(installation).toMatch(/installDemo\(\s*props\.document/);
		expect(runtime).toContain("<FormRenderer host={installed.host}");
		expect(installer).toContain("createKaladaV1Host({");
		expect(installer).toContain("strategy: session.strategy");
		expect(strategy).toContain("writeDirect:");
		expect(strategy).not.toMatch(/setFieldValue|setValueAtPath/);
		expect(host).toContain("key={`${fixture.id}:${source.key}`}");
		expect(runtime).not.toContain("createForm(");
		expect(host).not.toMatch(/useFormSelector|useField|fieldDynamic|<(?:input|textarea)\b/);
		expect(host.match(/<select\b/g)).toHaveLength(2);
	});

	it("preserves baseline routes while registering conditional scenarios in numeric order", async () => {
		const { baselineFixtures, demos } = await import("../demos/index");
		expect(baselineFixtures.map((fixture) => fixture.id)).toEqual([
			"basic-contact",
			"user-profile",
			"nested-address",
			"settings-panel",
			"product-entry",
			"rich-validation",
			"conditional-fields",
			"array-items",
			"custom-layout",
			"multi-section-responsive",
			"search-filters",
			"survey",
			"multi-schema-sources",
			"order-entry",
			"kitchen-sink",
			"custom-renderers",
			"custom-layout-types",
			"arbiter-visibility",
			"arbiter-calculated",
			"arbiter-validation-gating",
			"arbiter-dynamic-sections",
		]);
		expect(demos.at(-1)?.id).toBe("schema-compilation");
		expect(demos).toHaveLength(22);
	});
});
