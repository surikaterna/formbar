// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { filtersAppliedEvent } from "../actions/search-filter-actions";
import { searchFiltersDemo } from "../demos/11-search-filters";
import { disposeDemoSession, installDemo } from "../runtime/kalada-demo-install";
import type { Issue } from "../runtime/kalada-demo-store";
import { deferred } from "./kalada-audit-fixtures";

function filters(validators: Parameters<typeof installDemo>[5] = {}) {
	const source = searchFiltersDemo.sources[0];
	return installDemo(
		{ version: 2, schema: source.schema, definition: source.definition, initialData: source.initialData },
		undefined,
		["formbar.standard.v1", "demo11.search-actions.v1"],
		{},
		undefined,
		validators,
	);
}

it("R10 the REAL demo11 Apply filters dispatches exactly once after its owned validation revision", async () => {
	const event = vi.fn();
	window.addEventListener(filtersAppliedEvent, event);
	const host = filters();
	try {
		expect(
			host
				.snapshot()
				.controls.find((control) => control.nodeId === "f-query")
				?.writers.value?.("kalada").status,
		).toBe("applied");
		const action = host.snapshot().tree.children?.find((node) => node.nodeId === "apply")?.action;
		expect((await action?.invoke())?.status).toBe("applied");
		expect(event).toHaveBeenCalledTimes(1);
		expect((event.mock.calls[0][0] as CustomEvent).detail).toEqual({ query: "kalada" });
		expect((await action?.invoke())?.status).toBe("stale");
		expect(event).toHaveBeenCalledTimes(1);
	} finally {
		disposeDemoSession(host);
		window.removeEventListener(filtersAppliedEvent, event);
	}
});

it("R10 foreign edit during REAL demo11 deferred validation cannot dispatch an event", async () => {
	const pending = deferred<readonly Issue[]>();
	const event = vi.fn();
	window.addEventListener(filtersAppliedEvent, event);
	const host = filters({ validators: [() => pending.promise] });
	try {
		const action = host.snapshot().tree.children?.find((node) => node.nodeId === "apply")?.action;
		const result = action?.invoke();
		expect(
			host
				.snapshot()
				.controls.find((control) => control.nodeId === "f-query")
				?.writers.value?.("foreign edit").status,
		).toBe("applied");
		pending.settle([]);
		expect((await result)?.status).not.toBe("applied");
		expect(event).not.toHaveBeenCalled();
	} finally {
		disposeDemoSession(host);
		window.removeEventListener(filtersAppliedEvent, event);
	}
});
