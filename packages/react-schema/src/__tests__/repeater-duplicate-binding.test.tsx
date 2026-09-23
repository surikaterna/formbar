// @vitest-environment jsdom
import type { FormDefinition, FormNode } from "@formbar/declarative";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { RepeaterCoordinator } from "../repeater-coordinator.js";
import { binding, mountForm } from "./renderer-test-utils.js";

const scoped = (scope: string, ...segments: readonly string[]) => ({ namespace: "data" as const, segments, scope });

async function click(button: HTMLButtonElement): Promise<void> {
	await act(async () => {
		button.click();
		await Promise.resolve();
		await Promise.resolve();
	});
}

function button(container: ParentNode, label: string): HTMLButtonElement {
	const match = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
	if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
	return match;
}

function rowButton(container: ParentNode, label: string, item: number): HTMLButtonElement {
	const match = container.querySelector(`button[aria-label="${label}, item ${item}"]`);
	if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing row button: ${label} ${item}`);
	return match;
}

function repeaterNode(id: string, scope: string, target = binding("rows")): FormNode {
	return {
		type: "repeater",
		id,
		binding: target,
		scope,
		label: id,
		children: [
			{ type: "field", id: `${id}-value`, binding: scoped(scope), widget: "text" },
			{ type: "action", id: `${id}-remove`, action: "array.remove", target, label: `Remove ${id}` },
			{
				type: "action",
				id: `${id}-move`,
				action: "array.move",
				target,
				payload: { kind: "literal", value: { offset: -1 } },
				label: `Move ${id}`,
			},
			{
				type: "action",
				id: `${id}-swap`,
				action: "array.swap",
				target,
				payload: { kind: "literal", value: { to: 0 } },
				label: `Swap ${id}`,
			},
		],
	};
}

function appendNode(id: string, target = binding("rows")): FormNode {
	return {
		type: "action",
		id: `${id}-append`,
		action: "array.append",
		target,
		payload: { kind: "literal", value: `${id}-appended` },
		label: `Append ${id}`,
	};
}

function insertNode(id: string, target = binding("rows")): FormNode {
	return {
		type: "action",
		id: `${id}-insert`,
		action: "array.insert",
		target,
		payload: { kind: "literal", value: { index: 1, item: `${id}-inserted` } },
		label: `Insert ${id}`,
	};
}

function duplicateDefinition(appendB = true): FormDefinition {
	return {
		version: 1,
		id: "duplicate-binding",
		root: {
			type: "group",
			id: "root",
			children: [
				repeaterNode("A", "rowA"),
				appendNode("A"),
				insertNode("A"),
				repeaterNode("B", "rowB"),
				...(appendB ? [appendNode("B")] : []),
				insertNode("B"),
			],
		},
	};
}

function fieldset(container: ParentNode, id: string): HTMLFieldSetElement {
	const match = container.querySelector(`fieldset[data-formbar-node="${id}"]`);
	if (!(match instanceof HTMLFieldSetElement)) throw new Error(`Missing repeater: ${id}`);
	return match;
}

describe("duplicate-binding repeater focus", () => {
	it("isolates append, insert, remove, move, and swap intents by concrete repeater", async () => {
		const view = mountForm({
			schema: { type: "object", properties: { rows: { type: "array", items: { type: "string" } } } },
			definition: duplicateDefinition(),
			data: { rows: ["a", "b"] },
		});
		const repeaterA = () => fieldset(view.container, "A");
		const repeaterB = () => fieldset(view.container, "B");

		await click(button(view.container, "Append A"));
		expect(view.form.getState().data.rows).toEqual(["a", "b", "A-appended"]);
		expect(document.activeElement).toBe(repeaterA().querySelectorAll("input")[2]);
		act(() => view.form.reset());
		await click(button(view.container, "Insert B"));
		expect(view.form.getState().data.rows).toEqual(["a", "B-inserted", "b"]);
		expect(document.activeElement).toBe(repeaterB().querySelectorAll("input")[1]);

		act(() => view.form.setValue("rows", ["only"]));
		await click(rowButton(repeaterB(), "Remove B", 1));
		expect(document.activeElement).toBe(button(view.container, "Append B"));
		act(() => view.form.setValue("rows", ["only"]));
		await click(rowButton(repeaterA(), "Remove A", 1));
		expect(document.activeElement).toBe(button(view.container, "Append A"));

		act(() => view.form.reset());
		const beforeMoveA = [...repeaterA().querySelectorAll("input")];
		const beforeMoveB = [...repeaterB().querySelectorAll("input")];
		const moveA = rowButton(repeaterA(), "Move A", 2);
		await click(moveA);
		expect(view.form.getState().data.rows).toEqual(["b", "a"]);
		expect([...repeaterA().querySelectorAll("input")]).toEqual([beforeMoveA[1], beforeMoveA[0]]);
		expect([...repeaterB().querySelectorAll("input")]).toEqual(beforeMoveB);
		expect(document.activeElement).toBe(moveA);

		act(() => view.form.reset());
		const beforeSwapA = [...repeaterA().querySelectorAll("input")];
		const beforeSwapB = [...repeaterB().querySelectorAll("input")];
		const swapB = rowButton(repeaterB(), "Swap B", 2);
		await click(swapB);
		expect(view.form.getState().data.rows).toEqual(["b", "a"]);
		expect([...repeaterA().querySelectorAll("input")]).toEqual(beforeSwapA);
		expect([...repeaterB().querySelectorAll("input")]).toEqual([beforeSwapB[1], beforeSwapB[0]]);
		expect(document.activeElement).toBe(swapB);
		view.unmount();
	});

	it("falls back within B when its duplicate binding has no append control", async () => {
		const view = mountForm({
			schema: { type: "object", properties: { rows: { type: "array", items: { type: "string" } } } },
			definition: duplicateDefinition(false),
			data: { rows: ["only"] },
		});
		const repeaterB = fieldset(view.container, "B");

		await click(rowButton(repeaterB, "Remove B", 1));
		expect(document.activeElement).toBe(repeaterB);
		expect(document.activeElement).not.toBe(button(view.container, "Append A"));
		view.unmount();
	});

	it("isolates nested duplicate repeaters with one concrete child binding", async () => {
		const childTarget = scoped("outer", "children");
		const definition: FormDefinition = {
			version: 1,
			id: "nested-duplicates",
			root: {
				type: "repeater",
				id: "outer",
				binding: binding("rows"),
				scope: "outer",
				children: [
					repeaterNode("nested-A", "childA", childTarget),
					appendNode("nested-A", childTarget),
					repeaterNode("nested-B", "childB", childTarget),
					appendNode("nested-B", childTarget),
				],
			},
		};
		const view = mountForm({
			schema: {
				type: "object",
				properties: {
					rows: {
						type: "array",
						items: { type: "object", properties: { children: { type: "array", items: { type: "string" } } } },
					},
				},
			},
			definition,
			data: { rows: [{ children: ["only"] }] },
		});
		const nestedB = fieldset(view.container, "nested-B");

		await click(rowButton(nestedB, "Remove nested-B", 1));
		expect(view.form.getState().data.rows[0]?.children).toEqual([]);
		expect(document.activeElement).toBe(button(view.container, "Append nested-B"));
		view.unmount();
	});

	it("cleans every duplicate listener and append registration on StrictMode unmount", () => {
		const cleanups: ReturnType<typeof vi.fn>[] = [];
		const register = RepeaterCoordinator.prototype.register;
		const registerAppend = RepeaterCoordinator.prototype.registerAppend;
		const listenerSpy = vi.spyOn(RepeaterCoordinator.prototype, "register").mockImplementation(function (...args) {
			const cleanup = vi.fn(register.apply(this, args));
			cleanups.push(cleanup);
			return cleanup;
		});
		const appendSpy = vi.spyOn(RepeaterCoordinator.prototype, "registerAppend").mockImplementation(function (...args) {
			const cleanup = vi.fn(registerAppend.apply(this, args));
			cleanups.push(cleanup);
			return cleanup;
		});
		const view = mountForm({
			schema: { type: "object", properties: { rows: { type: "array", items: { type: "string" } } } },
			definition: duplicateDefinition(),
			data: { rows: ["only"] },
			strict: true,
		});

		view.unmount();
		expect(cleanups.length).toBeGreaterThan(0);
		for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledOnce();
		listenerSpy.mockRestore();
		appendSpy.mockRestore();
	});
});
