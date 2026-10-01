import { describe, expect, it } from "vitest";
import { conditionalFieldsDemo, conditionalFieldsSchema } from "../demos/07-conditional-fields";
import { surveyDemo, surveySchema } from "../demos/12-survey-questionnaire";
import { arbiterVisibilityDemo } from "../demos/18-arbiter-visibility";
import { arbiterDynamicSectionsDemo } from "../demos/21-arbiter-dynamic-sections";
import { installDemo } from "../runtime/kalada-demo-install";

describe("conditional fixture authority", () => {
	it("attests serializable branch bindings against the schema", () => {
		for (const fixture of [conditionalFieldsDemo, surveyDemo, arbiterVisibilityDemo, arbiterDynamicSectionsDemo]) {
			const source = fixture.sources[0];
			expect(() => JSON.stringify(fixture), fixture.id).not.toThrow();
			const host = installDemo({
				version: 2,
				schema: source.schema,
				definition: source.definition,
				initialData: source.initialData,
			});
			try {
				expect(host.snapshot().controls.length, fixture.id).toBeGreaterThan(0);
			} finally {
				host.dispose();
			}
		}
	});

	it("keeps the employment choices and survey follow-up requirement in the schema", () => {
		expect(conditionalFieldsSchema.required).toEqual(["employmentStatus"]);
		expect(conditionalFieldsSchema.properties.employmentStatus.enum).toEqual([
			"Employed",
			"Self-Employed",
			"Student",
			"Retired",
			"Unemployed",
		]);
		expect(surveySchema.then).toEqual({ required: ["email"], properties: { email: { minLength: 1 } } });
	});
});
