import { describe, expect, it } from "vitest";
import { demos } from "../demos/index";
import { getPlaygroundCompatibility } from "../playground/examples";
import runtime from "../renderers/SchemaFormRuntime.tsx?raw";

const fixtureModules = import.meta.glob(
	"../demos/{07-conditional-fields,12-survey-questionnaire,18-arbiter-visibility,21-arbiter-dynamic-sections}.ts",
	{ query: "?raw", import: "default", eager: true },
) as Readonly<Record<string, string>>;

const demoModules = import.meta.glob("../demos/*.ts", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Readonly<Record<string, string>>;

describe("conditional demo architecture", () => {
	it("keeps all four fixtures serializable and free of app-owned controls or state inspection", () => {
		const source = Object.values(fixtureModules).join("\n");
		expect(Object.keys(fixtureModules)).toHaveLength(4);
		expect(source).not.toMatch(/from ["']react|DemoFormRoot|DemoFormField|pruneHiddenFields/);
		expect(source).not.toMatch(/useFormSelector|useField|form\.subscribe|fieldMap|VISIBILITY_RULES|uiState.*show/);
		expect(source).not.toMatch(/<(?:input|select|textarea)\b/);
		expect(source).not.toMatch(/Object\.(?:keys|values|entries)\([^)]*properties|properties.*\.(?:map|forEach)/);
	});

	it("extends the sole schema host with one commit-phase released Arbiter plugin path", () => {
		expect(runtime.match(/useSchemaForm</g)).toHaveLength(1);
		expect(runtime.match(/<FormRenderer/g)).toHaveLength(1);
		expect(runtime.match(/createArbiterPlugin\(\{/g)).toHaveLength(1);
		expect(runtime).toMatch(/useEffect\(\(\) => \{[\s\S]*createArbiterPlugin/);
		expect(runtime).toContain("[rules]");
		expect(runtime).not.toMatch(/setFieldPolicy|createForm\(/);
	});

	it("contains normalized policy records only in the two Arbiter fixtures", () => {
		const owners = Object.entries(demoModules)
			.filter(([, source]) => source.includes("$formbar.fieldPolicy"))
			.map(([path]) => path.split("/").at(-1));
		expect(owners).toEqual(["18-arbiter-visibility.ts", "21-arbiter-dynamic-sections.ts"]);
	});

	it("keeps numeric demo routes with registry-derived playground support", () => {
		expect(demos.map((demo) => demo.id)).toEqual([
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
			"schema-compilation",
		]);
		expect(getPlaygroundCompatibility().map((entry) => entry.demoId)).toEqual(demos.map((demo) => demo.id));
	});
});
