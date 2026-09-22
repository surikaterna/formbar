import { describe, expect, it } from "vitest";
import { demos } from "../demos/index";
import { compatibilityMatrix } from "../playground/presets";
import host from "../renderers/SchemaDemoHost.tsx?raw";

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
		expect(host.match(/const prepared = useSchemaForm/g)).toHaveLength(1);
		expect(host.match(/<FormRenderer/g)).toHaveLength(1);
		expect(host.match(/createArbiterPlugin\(\{/g)).toHaveLength(1);
		expect(host).toMatch(/useEffect\(\(\) => \{[\s\S]*createArbiterPlugin/);
		expect(host).toContain("[rules]");
		expect(host).toContain("plugins,");
		expect(host).not.toMatch(/useMemo|useRef|useFormSelector|useField|form\.subscribe|setFieldPolicy|createForm\(/);
	});

	it("contains normalized policy records only in the two Arbiter fixtures", () => {
		const owners = Object.entries(demoModules)
			.filter(([, source]) => source.includes("$formbar.fieldPolicy"))
			.map(([path]) => path.split("/").at(-1));
		expect(owners).toEqual(["18-arbiter-visibility.ts", "21-arbiter-dynamic-sections.ts"]);
	});

	it("registers only the four requested routes without expanding playground support", () => {
		expect(demos.map((demo) => demo.id)).toEqual([
			"basic-contact",
			"user-profile",
			"nested-address",
			"settings-panel",
			"product-entry",
			"conditional-fields",
			"custom-layout",
			"multi-section-responsive",
			"survey",
			"multi-schema-sources",
			"kitchen-sink",
			"arbiter-visibility",
			"arbiter-dynamic-sections",
			"schema-compilation",
		]);
		expect(compatibilityMatrix.map((entry) => entry.demoId)).toEqual(["schema-compilation"]);
	});
});
