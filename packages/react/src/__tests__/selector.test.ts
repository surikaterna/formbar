import { createForm } from "@formbar/core";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { useField, useFormSelector } from "../index.js";

describe("useFormSelector", () => {
	test("is exported as a function", () => {
		expect(typeof useFormSelector).toBe("function");
	});

	test("provides a server snapshot", () => {
		const form = createForm({ initialData: { value: "server" } });
		function Selected() {
			return createElement(
				"span",
				null,
				useFormSelector(form, (state) => state.data.value),
			);
		}
		expect(renderToString(createElement(Selected))).toContain("server");
		form.dispose();
	});
});

describe("useField", () => {
	test("is exported as a function", () => {
		expect(typeof useField).toBe("function");
	});
});
