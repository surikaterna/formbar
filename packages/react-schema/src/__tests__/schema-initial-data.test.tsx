// @vitest-environment jsdom
import { jsonSchemaProvider } from "@formbar/from-schema";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useSchemaForm } from "../use-schema-form.js";

const provider = jsonSchemaProvider();
const schema = {
	type: "object",
	required: ["name", "address"],
	properties: {
		name: { type: "string", default: "Ada" },
		address: { type: "object", default: { city: "Paris", zip: "750" }, properties: { city: { type: "string" } } },
		tags: { type: "array", default: ["a"], items: { type: "string" } },
		count: { type: "number", default: 0 },
		active: { type: "boolean", default: false },
		empty: { type: "string", default: "" },
		ref: { $ref: "#/$defs/ref" },
		childOnly: { type: "object", properties: { city: { type: "string", default: "Rome" } } },
	},
	$defs: { ref: { type: "string", default: "Ref" } },
};

function mount(source: unknown = schema, initialData?: Record<string, unknown>, definition?: object) {
	const onSubmit = vi.fn(async () => ({ ok: true as const, submitId: "saved" }));
	let prepared: ReturnType<typeof useSchemaForm<Record<string, unknown>, Record<string, unknown>>> | undefined;
	function Hook() {
		prepared = useSchemaForm<Record<string, unknown>, Record<string, unknown>>(source, {
			provider,
			side: "input",
			...(initialData === undefined ? {} : { initialData }),
			...(definition ? { definition: definition as never } : {}),
			onSubmit,
		});
		return null;
	}
	renderToString(<Hook />);
	if (!prepared) throw Error("Hook was not called");
	return { ...prepared, onSubmit };
}

describe("historical shallow schema initialization", () => {
	it("owns the first SSR and StrictMode render snapshot before deferred plugin initialization", async () => {
		const observed: boolean[] = [];
		const init = vi.fn(({ getState }) => observed.push(Object.isFrozen(getState().data)));
		const options = {
			provider,
			side: "input" as const,
			ownedScheduling: true as const,
			plugins: [{ id: "init", onInit: init }],
		};
		const Schema = { type: "object", properties: { name: { type: "string", default: "Ada" } } };
		function Hook() {
			const { form } = useSchemaForm<Record<string, unknown>, Record<string, unknown>>(Schema, options);
			observed.push(Object.isFrozen(form.getState().data) && Object.isFrozen(form.getState().fieldPolicy));
			return null;
		}
		renderToString(<Hook />);
		expect(observed).toEqual([true]);
		expect(init).not.toHaveBeenCalled();
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(document.createElement("div"));
		await act(async () =>
			root.render(
				<StrictMode>
					<Hook />
				</StrictMode>,
			),
		);
		expect(observed.every(Boolean)).toBe(true);
		expect(init).toHaveBeenCalled();
		await act(async () => root.unmount());
	});
	it("copies direct properties, submits real core data and resets the original snapshot", async () => {
		const { form, onSubmit } = mount();
		const original = {
			name: "Ada",
			address: { city: "Paris", zip: "750" },
			tags: ["a"],
			count: 0,
			active: false,
			empty: "",
			ref: "Ref",
		};
		expect(form.getState().data).toEqual(original);
		expect(form.validate()).toEqual([]);
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ payload: original });
		form.setValue("name", "Grace");
		form.setValue("tags", ["b"]);
		expect(form.getState().data).toMatchObject({ name: "Grace", tags: ["b"] });
		form.reset();
		expect(form.getState().data).toEqual(original);
		form.reset({ data: { name: "Manual" } });
		expect(form.getState().data).toEqual({ name: "Manual" });
		form.dispose();
	});

	it("uses own caller presence, not truthiness or recursive fill", () => {
		const caller = {
			name: undefined,
			address: { city: "Lyon" },
			tags: [],
			count: 0,
			active: false,
			empty: "",
			ref: null,
		};
		const { form } = mount(schema, caller);
		expect(form.getState().data).toEqual(caller);
		form.reset();
		expect(form.getState().data).toEqual(caller);
		form.dispose();
		const nullAddress = mount(schema, { address: null });
		expect(nullAddress.form.getState().data.address).toBeNull();
		nullAddress.form.dispose();
	});

	it("does not depend on authored presentation and leaves literal dotted property names intact", () => {
		const generated = mount();
		const authored = mount(schema, undefined, generated.definition);
		expect(authored.form.getState().data).toEqual(generated.form.getState().data);
		generated.form.dispose();
		authored.form.dispose();
		const dotted = mount({ type: "object", properties: { "a.b": { default: "literal" } } });
		expect(dotted.form.getState().data).toEqual({ "a.b": "literal" });
		dotted.form.dispose();
	});

	it("preserves literal $type keys in direct and nested JSON defaults through submit and reset", async () => {
		const original = {
			metadata: { $type: "literal", value: 7 },
			address: { city: "Paris", details: { $type: "undefined", value: 9 } },
		};
		const { form, warnings, onSubmit } = mount({
			type: "object",
			required: ["metadata", "address"],
			properties: {
				metadata: { type: "object", default: original.metadata },
				address: { type: "object", default: original.address },
			},
		});
		expect(warnings.filter((warning) => warning.channel === "initialization")).toEqual([]);
		expect(form.getState().data).toEqual(original);
		expect(form.validate()).toEqual([]);
		expect(await form.submit()).toMatchObject({ ok: true });
		expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ payload: original });
		form.setValue("metadata", { $type: "edited" });
		form.reset();
		expect(form.getState().data).toEqual(original);
		form.dispose();
	});

	it("does not reapply a changed schema default to a mounted form", async () => {
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const container = document.createElement("div");
		const root = createRoot(container);
		let form: ReturnType<typeof mount>["form"] | undefined;
		function Hook({ value }: { value: string }) {
			form = useSchemaForm<Record<string, unknown>, Record<string, unknown>>(
				{ type: "object", properties: { name: { default: value } } },
				{ provider, side: "input" },
			).form;
			return null;
		}
		await act(async () => root.render(<Hook value="Ada" />));
		expect(form?.getState().data).toEqual({ name: "Ada" });
		await act(async () => form?.setValue("name", "Edited"));
		await act(async () => root.render(<Hook value="Grace" />));
		expect(form?.getState().data).toEqual({ name: "Edited" });
		await act(async () => root.unmount());
		form?.dispose();
		globalThis.IS_REACT_ACT_ENVIRONMENT = false;
	});

	it("chooses own ref annotation before target and skips an unsafe own annotation without fallback", () => {
		const { form, warnings } = mount({
			type: "object",
			properties: {
				own: { $ref: "#/$defs/word", default: "own" },
				target: { $ref: "#/$defs/word" },
				unsafe: { $ref: "#/$defs/word", default: { constructor: "bad" } },
			},
			$defs: { word: { type: "string", default: "target" } },
		});
		expect(form.getState().data).toEqual({ own: "own", target: "target" });
		expect(warnings).toEqual(
			expect.arrayContaining([expect.objectContaining({ message: "Skipped unsafe default for unsafe" })]),
		);
		form.dispose();
	});

	it("valid default passes #203 validation; invalid overrides fail without losing prior submit", async () => {
		const valid = mount();
		expect(await valid.form.submit()).toMatchObject({ ok: true });
		valid.form.dispose();
		for (const override of [null, undefined, { city: 42 }]) {
			const { form, onSubmit } = mount(schema, { address: override });
			expect(form.validate().length).toBeGreaterThan(0);
			expect(await form.submit()).toMatchObject({ ok: false, reason: "validation-failed" });
			expect(onSubmit).not.toHaveBeenCalled();
			form.reset();
			expect(form.getState().data.address).toEqual(override);
			form.dispose();
		}
	});

	it("does not create child-only, root scalar, item or minItems defaults", () => {
		const { form } = mount({
			type: "object",
			properties: {
				nested: { type: "object", properties: { city: { default: "Paris" } } },
				list: { type: "array", minItems: 2, items: { default: "a" } },
				value: { const: "fixed" },
			},
		});
		expect(form.getState().data).toEqual({});
		form.dispose();
		const scalar = mount({ type: "string", default: "root" });
		expect(scalar.form.getState().data).toEqual({});
		scalar.form.dispose();
	});

	it("skips unsafe defaults with a warning, never reads accessors, and rejects unsafe callers", () => {
		const polluted = JSON.parse('{"__proto__": "bad"}');
		const { form, warnings } = mount({
			type: "object",
			properties: { safe: { default: "ok" }, unsafe: { default: polluted } },
		});
		expect(form.getState().data).toEqual({ safe: "ok" });
		expect(warnings).toEqual(
			expect.arrayContaining([expect.objectContaining({ channel: "initialization", code: "unsafe-default" })]),
		);
		form.dispose();
		let reads = 0;
		const accessor = Object.defineProperty({}, "safe", {
			enumerable: true,
			get() {
				reads++;
				return "bad";
			},
		});
		expect(() => mount(schema, accessor)).toThrow(TypeError);
		expect(reads).toBe(0);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => mount(schema, cyclic)).toThrow(TypeError);
		expect(() => mount(schema, JSON.parse('{"__proto__": 1}'))).toThrow(TypeError);
		const sparse = Array(2);
		const unsafeArray = mount({ type: "object", properties: { list: { default: sparse } } });
		expect(unsafeArray.form.getState().data).toEqual({});
		expect(unsafeArray.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unsafe-default" })]));
		unsafeArray.form.dispose();
	});

	it("does not hide a malformed annotated default from JSON Schema validation", async () => {
		const { form, onSubmit } = mount({
			type: "object",
			required: ["age"],
			properties: { age: { type: "integer", default: "invalid" } },
		});
		expect(form.getState().data).toEqual({ age: "invalid" });
		expect(form.validate().map((issue) => issue.code)).toContain("json-schema.type");
		expect(await form.submit()).toMatchObject({ ok: false, reason: "validation-failed" });
		expect(onSubmit).not.toHaveBeenCalled();
		form.dispose();
	});
});
