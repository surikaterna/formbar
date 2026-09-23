// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaygroundRunner } from "../playground/PlaygroundRunner";
import { getPlaygroundExample } from "../playground/examples";
import { applySources, createPlaygroundSession, updateSource } from "../playground/session";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const stats = vi.hoisted(() => ({ created: 0, disposed: 0, active: 0, maxActive: 0 }));
vi.mock("@formbar/arbiter", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@formbar/arbiter")>();
	return {
		...actual,
		createArbiterPlugin: (...args: Parameters<typeof actual.createArbiterPlugin>) => {
			stats.created++;
			stats.active++;
			stats.maxActive = Math.max(stats.maxActive, stats.active);
			const plugin = actual.createArbiterPlugin(...args);
			return {
				...plugin,
				onDispose: () => {
					stats.disposed++;
					stats.active--;
					plugin.onDispose?.();
				},
			};
		},
	};
});

function requiredExample(id: string) {
	const example = getPlaygroundExample(id);
	if (!example) throw new Error(`Missing example ${id}`);
	return example;
}

const arbiter = requiredExample("arbiter-visibility");
const plain = requiredExample("basic-contact");

beforeEach(() => Object.assign(stats, { created: 0, disposed: 0, active: 0, maxActive: 0 }));
afterEach(() => document.body.replaceChildren());

describe("playground runtime lifecycle", () => {
	it("keeps one active Arbiter in StrictMode, disposes on switch, and starts a clean remount", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		act(() =>
			root.render(
				<StrictMode>
					<PlaygroundRunner document={arbiter.document} runtime={arbiter.runtime} />
				</StrictMode>,
			),
		);
		expect(stats).toMatchObject({ created: 2, disposed: 1, active: 1, maxActive: 1 });
		act(() => root.render(<PlaygroundRunner document={plain.document} runtime={plain.runtime} />));
		expect(stats).toMatchObject({ created: 2, disposed: 2, active: 0, maxActive: 1 });
		act(() => root.render(<PlaygroundRunner document={arbiter.document} runtime={arbiter.runtime} />));
		expect(stats).toMatchObject({ created: 3, disposed: 2, active: 1, maxActive: 1 });
		act(() => root.unmount());
		await act(async () => Promise.resolve());
		expect(stats).toMatchObject({ created: 3, disposed: 3, active: 0, maxActive: 1 });
	});

	it("does not replace the live Arbiter session after rejected schema preflight", () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		const original = createPlaygroundSession(arbiter.document);
		act(() =>
			root.render(<PlaygroundRunner key={original.revision} document={original.applied} runtime={arbiter.runtime} />),
		);
		const form = container.querySelector("form");
		expect(form).not.toBeNull();
		expect(stats).toMatchObject({ created: 1, disposed: 0, active: 1, maxActive: 1 });

		const edited = updateSource(original, "schema", '{"type":"object","minProperties":-1}');
		const rejected = applySources(edited);
		act(() =>
			root.render(<PlaygroundRunner key={rejected.revision} document={rejected.applied} runtime={arbiter.runtime} />),
		);
		expect(rejected.applied).toBe(original.applied);
		expect(container.querySelector("form")).toBe(form);
		expect(stats).toMatchObject({ created: 1, disposed: 0, active: 1, maxActive: 1 });

		const recovered = applySources(updateSource(rejected, "schema", original.sources.schema));
		act(() =>
			root.render(<PlaygroundRunner key={recovered.revision} document={recovered.applied} runtime={arbiter.runtime} />),
		);
		expect(container.querySelector("form")).not.toBe(form);
		expect(stats).toMatchObject({ created: 2, disposed: 1, active: 1, maxActive: 1 });
		act(() => root.unmount());
		expect(stats).toMatchObject({ created: 2, disposed: 2, active: 0, maxActive: 1 });
	});

	it("server-renders and hydrates a plain shared runtime form", async () => {
		const element = <PlaygroundRunner document={plain.document} runtime={plain.runtime} />;
		const html = renderToString(element);
		expect(html).toContain("<form");
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const recoverable: unknown[] = [];
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, element, {
				onRecoverableError: (error) => recoverable.push(error),
			});
			await Promise.resolve();
		});
		expect(container.querySelector("form")).not.toBeNull();
		expect(recoverable).toEqual([]);
		expect(errors).not.toHaveBeenCalled();
		act(() => root.unmount());
		errors.mockRestore();
	});

	it("server-renders deterministic Arbiter preparation without allocation", () => {
		const html = renderToString(<PlaygroundRunner document={arbiter.document} runtime={arbiter.runtime} />);
		expect(html).toContain("Preparing rule-governed form.");
		expect(html).toContain('aria-busy="true"');
		expect(stats.created).toBe(0);
	});
});
