import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompilationPreview } from "../renderers/CompilationPreview";

describe("CompilationPreview", () => {
	it("labels legacy sources without claiming a validated or interactive compilation", () => {
		const html = renderToStaticMarkup(
			<CompilationPreview
				schema={{ type: "object", properties: { name: { type: "string", minLength: 2 } } }}
				initialData={{ name: "Ada" }}
			/>,
		);
		expect(html).toContain("no app-installed data strategy or host policy");
		expect(html).toContain("Legacy definition source (unvalidated)");
		expect(html).not.toContain("Descriptor document and evidence");
		expect(html).toContain("Initial data (read-only)");
		expect(html).toContain("Ada");
		expect(html).not.toContain("<form");
		expect(html).not.toContain("<input");
	});
});
