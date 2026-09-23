import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompilationPreview } from "../renderers/CompilationPreview";

describe("CompilationPreview", () => {
	it("is an explicit read-only compilation view with no form store or domain controls", () => {
		const html = renderToStaticMarkup(
			<CompilationPreview
				schema={{ type: "object", properties: { name: { type: "string", minLength: 2 } } }}
				initialData={{ name: "Ada" }}
			/>,
		);
		expect(html).toContain("read-only compiler view");
		expect(html).toContain("Descriptor document and evidence");
		expect(html).toContain("Initial data (read-only)");
		expect(html).toContain("Ada");
		expect(html).not.toContain("<form");
		expect(html).not.toContain("<input");
	});
});
