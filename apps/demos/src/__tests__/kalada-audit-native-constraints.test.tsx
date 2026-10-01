// @vitest-environment jsdom
import { FormRenderer } from "@formbar/react-schema";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { literalProp, nativeFixture, nativeMatrix } from "./kalada-audit-native-fixture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: (() => void)[] = [];
afterEach(() => {
	for (const dispose of mounted.splice(0)) dispose();
	document.body.replaceChildren();
});
function mount(
	generated = false,
	extra: Parameters<typeof nativeFixture>[1] = {},
	field: Parameters<typeof nativeFixture>[2] = "number",
) {
	const fixture = nativeFixture(generated, extra, field);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => root.render(<FormRenderer host={fixture.host} />));
	mounted.push(() => {
		act(() => root.unmount());
		fixture.dispose();
	});
	const control = (name: string) =>
		fixture.host.snapshot().controls[nativeMatrix.indexOf(name as (typeof nativeMatrix)[number])];
	const element = (name: string) =>
		container.querySelector<HTMLInputElement>(
			`[data-kalada-control="${control(name).nodeId}"] input,[data-kalada-control="${control(name).nodeId}"] textarea,[data-kalada-control="${control(name).nodeId}"] select`,
		);
	return { ...fixture, container, control, element };
}
function edit(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
	act(() => {
		const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

it.each([false, true])(
	"R14 full original native attribute/type matrix traces authored/generated=%s evidence",
	(generated) => {
		const view = mount(generated);
		for (const name of nativeMatrix) {
			const element = view.element(name);
			expect(element, name).not.toBeNull();
			if (name === "textarea") expect(element?.tagName).toBe("TEXTAREA");
			else if (name === "select") expect(element?.tagName).toBe("SELECT");
			else expect(element?.type, name).toBe(name === "integer" ? "number" : name === "formatted" ? "email" : name);
		}
		const text = view.element("text");
		expect([text?.minLength, text?.maxLength, text?.pattern, text?.placeholder]).toEqual([
			2,
			8,
			"^[a-z]*$",
			"Enter text",
		]);
		const numeric = view.element("number");
		expect([numeric?.min, numeric?.max, numeric?.step]).toEqual(["1", "9", "any"]);
		expect(view.element("integer")?.step).toBe("1");
		expect([
			view.element("textarea")?.minLength,
			view.element("textarea")?.maxLength,
			view.element("textarea")?.placeholder,
		]).toEqual([1, 20, "Enter textarea"]);
	},
);

it("R14 decimal/empty/null and typed select/checkbox/radio semantics use real installed host writers", () => {
	const view = mount();
	const input = view.element("number");
	if (!input) throw new Error("Missing numeric input");
	edit(input, "1.5");
	expect(view.host.snapshot().data).toMatchObject({ number: 1.5 });
	expect(input.validity.stepMismatch).toBe(false);
	expect(input.checkValidity()).toBe(true);
	edit(input, "not-a-number");
	expect(view.host.snapshot().data).toMatchObject({ number: null });
	edit(input, "");
	expect(view.host.snapshot().data).toMatchObject({ number: null });
	const select = view.element("select");
	if (!(select instanceof HTMLSelectElement)) throw new Error("Missing select");
	act(() => {
		select.value = "1";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	expect(view.host.snapshot().data).toMatchObject({ select: 2 });
	act(() => {
		select.value = "";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	expect(view.host.snapshot().data).toMatchObject({ select: null });
	act(() => view.element("checkbox")?.click());
	expect(view.host.snapshot().data).toMatchObject({ checkbox: true });
	act(() => view.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[2].click());
	expect(view.host.snapshot().data).toMatchObject({ radio: true });
});

it("R14 all original string/temporal edit assertions retain typed strings; explicit temporal empties are JSON null", () => {
	const view = mount();
	for (const [name, value] of Object.entries({
		text: "abc",
		textarea: "updated textarea",
		email: "next@example.com",
		url: "https://formbar.dev",
		tel: "+1234",
		password: "updated password",
		search: "updated search",
		formatted: "format@example.com",
		date: "2027-01-02",
		time: "13:45",
	})) {
		const input = view.element(name);
		if (!input) throw new Error(`Missing ${name}`);
		edit(input, value);
		expect(view.host.snapshot().data, name).toHaveProperty(name, value);
	}
	for (const name of ["date", "time"]) {
		const input = view.element(name);
		if (!input) throw new Error(`Missing ${name}`);
		edit(input, "");
		expect(view.host.snapshot().data).toHaveProperty(name, null);
	}
});

it("R14 authored literals override evidence and DOM-valid presentation never authorizes host-invalid submission", async () => {
	const view = mount(false, {
		min: literalProp(0),
		max: literalProp(20),
		step: literalProp("any"),
		placeholder: literalProp("Authored decimal"),
	});
	const number = view.element("number");
	if (!number) throw new Error("Missing number");
	expect([number.min, number.max, number.step, number.placeholder]).toEqual(["0", "20", "any", "Authored decimal"]);
	edit(number, "0.5");
	expect(number.checkValidity()).toBe(true);
	const check = vi.spyOn(HTMLFormElement.prototype, "checkValidity");
	const report = vi.spyOn(HTMLFormElement.prototype, "reportValidity");
	try {
		expect((await view.host.submit()).status).toBe("denied");
		expect(check).not.toHaveBeenCalled();
		expect(report).not.toHaveBeenCalled();
	} finally {
		check.mockRestore();
		report.mockRestore();
	}
	expect(view.host.snapshot().lifecycle?.issues.schema.join(" ")).toContain("minimum");
});

it.each([
	["min", "wrong"],
	["max", true],
	["step", 0],
	["step", -1],
	["step", "0.5"],
	["placeholder", 42],
])("R14 wrong-type/unsafe %s constraint refuses at the exact native value path", (name, value) => {
	expect(() => nativeFixture(false, { [name]: literalProp(value) })).toThrow(
		`root.children[2].props.${name}.value: INVALID_NATIVE_CONSTRAINT`,
	);
});

it("R14 reversed ranges, unknown handler attributes and non-finite writes fail closed without mutation", () => {
	expect(() => nativeFixture(false, { min: literalProp(10), max: literalProp(1) })).toThrow(
		"root.children[2].props.max.value: INVALID_NATIVE_CONSTRAINT_RANGE",
	);
	expect(() => nativeFixture(false, { onChange: literalProp("injected handler") })).toThrow(
		"root.children[2].props.onChange: UNSUPPORTED_NATIVE_PROP",
	);
	const view = mount();
	const data = view.host.snapshot().data;
	const revision = view.host.currentRevision();
	expect(view.control("number").writers.value?.(Number.POSITIVE_INFINITY).status).not.toBe("applied");
	expect(view.host.currentRevision()).toBe(revision);
	expect(view.host.snapshot().data).toEqual(data);
});

it.each([
	["minLength", -1],
	["maxLength", 2.5],
	["pattern", "["],
	["pattern", "x".repeat(1025)],
	["placeholder", "x".repeat(4097)],
])("R14 bounded text %s constraints refuse rather than silently being ignored", (key, value) => {
	expect(() => nativeFixture(false, { [key]: literalProp(value) }, "text")).toThrow(
		`root.children[0].props.${key}.value:`,
	);
});

it("R14 text length and temporal ranges/types are validated at admission", () => {
	expect(() => nativeFixture(false, { minLength: literalProp(9), maxLength: literalProp(2) }, "text")).toThrow(
		"root.children[0].props.maxLength.value: INVALID_NATIVE_CONSTRAINT_RANGE",
	);
	expect(() => nativeFixture(false, { min: literalProp(123) }, "date")).toThrow(
		"root.children[6].props.min.value: INVALID_NATIVE_CONSTRAINT",
	);
	expect(() => nativeFixture(false, { min: literalProp("2024-02-30") }, "date")).toThrow(
		"root.children[6].props.min.value: INVALID_NATIVE_CONSTRAINT",
	);
	expect(() => nativeFixture(false, { min: literalProp("23:00"), max: literalProp("01:00") }, "time")).toThrow(
		"root.children[7].props.max.value: INVALID_NATIVE_CONSTRAINT_RANGE",
	);
});

it.each([
	["date", "2026-01-01", "2027-12-31", 2],
	["time", "09:00", "17:30", 30],
] as const)("R14 %s bounds and step reach the installed temporal control", (type, min, max, step) => {
	const view = mount(false, { min: literalProp(min), max: literalProp(max), step: literalProp(step) }, type);
	const input = view.element(type);
	expect([input?.min, input?.max, input?.step]).toEqual([min, max, String(step)]);
});

it("R14 preserves the original native temporal accepted/rejected display matrix without changing retained data", () => {
	const view = mount();
	const accepted = {
		date: ["0001-01-01", "2026-09-22", "2000-02-29", "10000-01-01", "275760-09-13"],
		time: ["00:00", "23:59", "00:00:00", "23:59:59", "12:30:00.1", "12:30:00.12", "12:30:00.123"],
	};
	const rejected = {
		date: [
			"0000-01-01",
			"1900-02-29",
			"2024-04-31",
			"275760-09-14",
			"275760-12-31",
			"275761-01-01",
			"99999999999999999999999999999999-01-01",
		],
		time: ["12:30:00.1234", "24:00", "23:60", "23:59:60"],
	};
	for (const type of ["date", "time"] as const) {
		for (const value of accepted[type]) {
			act(() => {
				expect(view.control(type).writers.value?.(value).status).toBe("applied");
			});
			expect(view.element(type)?.value).toBe(value);
		}
		for (const value of rejected[type]) {
			act(() => {
				expect(view.control(type).writers.value?.(value).status).toBe("applied");
			});
			expect(view.host.snapshot().data).toHaveProperty(type, value);
			expect(view.element(type)).toBeNull();
			expect(
				view.container.querySelector(
					`[data-kalada-control="${view.control(type).nodeId}"] [data-formbar-diagnostic="unsupported-widget"]`,
				),
			).not.toBeNull();
		}
	}
});
