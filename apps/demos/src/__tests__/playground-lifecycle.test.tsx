// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaygroundRunner } from "../playground/PlaygroundRunner";
import { getPlaygroundExample } from "../playground/examples";
import { applySources, createPlaygroundSession, updateSource } from "../playground/session";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const stats = vi.hoisted(() => ({ created: 0 }));
vi.mock("@formbar/arbiter", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@formbar/arbiter")>();
	return {
		...actual,
		createArbiterPlugin: (...args: Parameters<typeof actual.createArbiterPlugin>) => {
			stats.created++;
			return actual.createArbiterPlugin(...args);
		},
	};
});

function example(id: string) {
	const result = getPlaygroundExample(id);
	if (!result) throw new Error(`Missing example ${id}`);
	return result;
}

afterEach(() => {
	document.body.replaceChildren();
	stats.created = 0;
});

describe("playground migration boundary", () => {
	it("mounts canonical and schema-only forms across StrictMode switches", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		for (const id of ["arbiter-visibility", "basic-contact:schema-options", "arbiter-visibility"]) {
			const selected =
				id === "basic-contact:schema-options" ? getPlaygroundExample("basic-contact", "schema-options") : example(id);
			if (!selected) throw new Error("Missing supported schema-only example");
			act(() =>
				root.render(
					<StrictMode>
						<PlaygroundRunner document={selected.document} runtime={selected.runtime} />
					</StrictMode>,
				),
			);
			expect(container.querySelector("form")).not.toBeNull();
			expect(container.querySelector('[role="alert"]')).toBeNull();
			if (id === "arbiter-visibility") expect(stats.created).toBeGreaterThan(0);
		}
		act(() => root.unmount());
	});

	it("rejects invalid schema edits without exposing an interactive fallback", () => {
		const selected = example("arbiter-visibility");
		const session = createPlaygroundSession(selected.document);
		const rejected = applySources(updateSource(session, "schema", '{"type":"object","minProperties":-1}'));
		expect(rejected.applied).toBe(session.applied);
		expect(rejected.errors.schema).toBeDefined();
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		act(() => root.render(<PlaygroundRunner document={rejected.applied} runtime={selected.runtime} />));
		expect(container.querySelector("form")).not.toBeNull();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(stats.created).toBeGreaterThan(0);
		act(() => root.unmount());
	});

	it("server-renders and hydrates a supported interactive form", async () => {
		const selected = getPlaygroundExample("basic-contact", "schema-options");
		if (!selected) throw new Error("Missing supported schema-only example");
		const element = <PlaygroundRunner document={selected.document} runtime={selected.runtime} />;
		const html = renderToString(element);
		expect(html).toContain("<form");
		expect(html).not.toContain("Demo migration required");
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const recoverable: unknown[] = [];
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, element, { onRecoverableError: (error) => recoverable.push(error) });
			await Promise.resolve();
		});
		expect(recoverable).toEqual([]);
		expect(container.querySelector("form")).not.toBeNull();
		act(() => root.unmount());
	});
});
