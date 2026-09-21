import { describe, expect, it, vi } from "vitest";
import { z as z3 } from "zod3-current";
import { z as z4 } from "zod4-current";
import { projectSchema, standardJsonSchemaProvider, zod3Provider, zod4Provider } from "../index.js";

describe("provider execution permissions", () => {
	it("does not invoke Zod shape or lazy callbacks by default", () => {
		const shape = vi.fn(() => ({ value: z3.string() }));
		const object = z3.object({}) as unknown as { _def: { shape: () => unknown } };
		object._def.shape = shape;
		const lazy = vi.fn(() => z4.string());
		projectSchema(object, { provider: zod3Provider(), side: "input" });
		projectSchema(z4.lazy(lazy), { provider: zod4Provider(), side: "input" });
		expect(shape).not.toHaveBeenCalled();
		expect(lazy).not.toHaveBeenCalled();
	});

	it("does not invoke Zod metadata access without metadata permission", () => {
		const schema = z4.string();
		const metadata = vi.fn(() => ({ formbar: { widget: "textarea" } }));
		Object.defineProperty(schema, "meta", { configurable: true, value: metadata });
		projectSchema(schema, { provider: zod4Provider(), side: "input" });
		expect(metadata).not.toHaveBeenCalled();
	});

	it("does not invoke Standard JSON conversion when execution is denied", () => {
		const input = vi.fn(() => ({ type: "string" }));
		const output = vi.fn(() => ({ type: "number" }));
		const schema = { "~standard": { version: 1, vendor: "test", jsonSchema: { input, output } } };
		projectSchema(schema, {
			provider: standardJsonSchemaProvider({ target: "draft-2020-12", execution: "deny" }),
			side: "input",
		});
		expect(input).not.toHaveBeenCalled();
		expect(output).not.toHaveBeenCalled();
	});
});
