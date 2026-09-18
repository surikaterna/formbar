import type { LayoutNode } from "@formbar/from-schema";
import { describe, expect, it } from "vitest";
import { createFormNavigationSession, normalizeNavigation } from "../index.js";

const layout: LayoutNode = {
	type: "group",
	id: "only",
	children: [{ type: "field", id: "value", path: "value" }],
};

function session() {
	const result = normalizeNavigation(layout);
	if (!result.ok) throw new Error("Expected valid navigation fixture");
	return createFormNavigationSession(result.value);
}

describe("disposed navigation sessions", () => {
	it("declines every operation from a one-group route", () => {
		const navigation = session();
		const target = { kind: "group" as const, id: "only" };
		navigation.dispose();

		expect(navigation.next(target)).toBe(false);
		expect(navigation.previous(target)).toBe(false);
		expect(navigation.advance(target)).toBe(false);
		expect(navigation.activate(target)).toBe(false);
		expect(navigation.back(target)).toBe(false);
		expect(navigation.focus(target)).toBe(false);
	});

	it("declines every operation from a one-field route", () => {
		const navigation = session();
		navigation.activate({ kind: "group", id: "only" });
		const target = { kind: "field" as const, path: "value" };
		navigation.dispose();

		expect(navigation.next(target)).toBe(false);
		expect(navigation.previous(target)).toBe(false);
		expect(navigation.advance(target)).toBe(false);
		expect(navigation.activate(target)).toBe(false);
		expect(navigation.back(target)).toBe(false);
		expect(navigation.focus(target)).toBe(false);
	});

	it("focuses only targets in the normalized model", () => {
		const navigation = session();
		expect(navigation.focus({ kind: "field", path: "missing" })).toBe(false);
		expect(navigation.focus({ kind: "group", id: "missing" })).toBe(false);
		expect(navigation.focus({ kind: "field", path: "value" })).toBe(true);
		expect(navigation.getSelectedTarget()).toEqual({ kind: "field", path: "value" });
		expect(navigation.focus({ kind: "group", id: "only" })).toBe(true);
		expect(navigation.getSelectedTarget()).toEqual({ kind: "group", id: "only" });
	});
});
