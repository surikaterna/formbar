import { useSchemaForm } from "@formbar/react-schema";
import { describe, expect, it, vi } from "vitest";
import { CompilationPreview } from "../renderers/CompilationPreview";

vi.mock("@formbar/react-schema", () => ({
	useSchemaForm: vi.fn(() => ({
		form: {},
		descriptors: {
			source: { provider: "json-schema", side: "input", availability: "complete" },
			nodes: {},
			occurrences: {},
			definitions: [],
			evidence: { n1: { primitive: "string", minLength: 2 } },
		},
		definition: { version: 1, id: "test", root: { id: "root", type: "group", children: [] } },
		diagnostics: { source: [], projection: [], compilation: [], definition: [] },
	})),
}));
vi.mock("@formbar/react", () => ({ useFormSelector: vi.fn(() => ({ name: "Ada" })) }));

describe("CompilationPreview", () => {
	it("is an explicit read-only compilation view with no domain controls", () => {
		const element = CompilationPreview({ schema: { type: "string" } });
		const serialized = JSON.stringify(element);
		expect(serialized).toContain("read-only");
		expect(serialized).toContain("read-only compiler view");
		expect(serialized).toContain("Descriptor document and evidence");
		expect(serialized).toContain('"evidence":{"n1":{"primitive":"string","minLength":2}}');
		expect(serialized).not.toContain('"type":"input"');
		expect(vi.mocked(useSchemaForm).mock.calls[0]?.[1]).toMatchObject({ side: "input" });
	});
});
