// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { fsxExamples } from "../fsx/registry";
import { useFsxSession } from "../fsx/use-fsx-session";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("captures exact failed Apply source/data bytes and discards the report on every draft/reset/success path", () => {
	let session: ReturnType<typeof useFsxSession> | undefined;
	function Harness() {
		session = useFsxSession(fsxExamples[0]);
		return null;
	}
	const root = createRoot(document.createElement("div"));
	const current = () => {
		if (!session) throw new Error("Missing session");
		return session;
	};
	try {
		act(() =>
			root.render(
				<StrictMode>
					<Harness />
				</StrictMode>,
			),
		);
		const source = fsxExamples[0].source.replace("value={name}", "value={missing}");
		const data = JSON.stringify(fsxExamples[0].data);
		act(() => {
			current().setSource(source);
			current().setData(data);
			current().apply();
		});
		expect(current().diagnosticReport).toEqual({ source, data, diagnostics: current().diagnostics });
		expect(current().applied.revision).toBe(1);
		act(() => current().setData(`${data} `));
		expect(current().diagnosticReport).toBeUndefined();
		act(() => current().apply());
		expect(current().diagnosticReport?.data).toBe(`${data} `);
		act(() => current().setSource(fsxExamples[0].source));
		expect(current().diagnosticReport).toBeUndefined();
		act(() => current().apply());
		expect(current().diagnostics).toEqual([]);
		expect(current().diagnosticReport).toBeUndefined();
		act(() => current().apply(source));
		expect(current().diagnosticReport?.source).toBe(source);
		act(() => current().reset());
		expect(current().diagnosticReport).toBeUndefined();
		expect(current().diagnostics).toEqual([]);
	} finally {
		act(() => root.unmount());
	}
});
