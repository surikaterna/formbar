import { describe, expect, it, vi } from "vitest";
import { compileFsx } from "../index.js";
import { fixture, source } from "./fixture.js";

describe("trusted FSX experimental compiler", () => {
	it("emits portable canonical V1 with transient UTF16 maps and zero evaluator calls", () => {
		const { options, host } = fixture();
		const calls = [
			vi.spyOn(host.strategy, "capture"),
			vi.spyOn(host.strategy, "writeDirect"),
			vi.spyOn(host.strategy, "captureSubmission"),
			vi.spyOn(host.strategy, "submitCaptured"),
		];
		const result = compileFsx(source, options);
		expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
		if (!result.ok) return;
		expect(result.definition.root).toMatchObject({ type: "group", id: "admin:root" });
		expect(result.validated.prepared.admitted.targets.get("root.children[4].children[0].children[0].binding")).toEqual({
			namespace: "data",
			path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "value"],
		});
		expect(JSON.parse(JSON.stringify(result.definition))).not.toHaveProperty("prepared");
		const binding = result.sourceMap.find((entry) => entry.path === "root.children[0].binding");
		expect(binding && source.slice(binding.range.start, binding.range.end)).toBe("name");
		for (const call of calls) expect(call).not.toHaveBeenCalled();
	});
	it("retains nested unique aliases without leaking aliases to siblings", () => {
		const { options } = fixture();
		const result = compileFsx(
			`<Form id="f" defaultLanguage="Kalada"><Alias as="a" value={name}><Alias as="b" value={a}><Field id="field" widget="text" value={b}/></Alias></Alias></Form>`,
			options,
		);
		expect(result).toMatchObject({
			ok: true,
			definition: { root: { children: [{ binding: { namespace: "data", segments: ["profile", "name"] } }] } },
		});
		expect(
			compileFsx(
				`<Form id="f" defaultLanguage="Kalada"><Alias as="a" value={name}/><Output id="o" value={a}/></Form>`,
				options,
			),
		).toMatchObject({ ok: false, diagnostics: [{ code: "KALADA_SYNTAX_UNKNOWN_REFERENCE" }] });
	});
	it("generates a stable collision-safe group id", () => {
		const { options } = fixture();
		const text = `<Form id="f" defaultLanguage="Kalada"><Group id="f:root"/></Form>`;
		const first = compileFsx(text, options);
		expect(first).toMatchObject({ ok: true, definition: { root: { id: "f:root:1" } } });
		expect(compileFsx(text, options)).toEqual(first);
	});
	it.each([
		['<Form defaultLanguage="Kalada"/>', "MISSING_ATTRIBUTE"],
		['<Form id="f"/>', "MISSING_ATTRIBUTE"],
		['<Form id="f" id="g" defaultLanguage="Kalada"/>', "DUPLICATE_ATTRIBUTE"],
		['<Form id="f" defaultLanguage="Kuery"/>', "UNKNOWN_DEFAULT_LANGUAGE"],
		[
			'<Form id="f" defaultLanguage="Kalada"><Field id="f" value={name} widget="text"/></Form>',
			"DUPLICATE_OR_INVALID_ID",
		],
		[
			'<Form id="f" defaultLanguage="Kalada"><Field id="x" value={name + 1} widget="text"/></Form>',
			"KALADA_SYNTAX_WRITE_INELIGIBLE",
		],
		[
			'<Form id="f" defaultLanguage="Kalada"><Field id="x" value={name?.x} widget="text"/></Form>',
			"KALADA_SYNTAX_WRITE_INELIGIBLE",
		],
		[
			'<Form id="f" defaultLanguage="Kalada"><Field id="x" value={name} widget="text" onChange={name}/></Form>',
			"UNKNOWN_ATTRIBUTE",
		],
		['<Form id="f" defaultLanguage="Kalada"><Alias as="name" value={name}/></Form>', "DUPLICATE_OR_INVALID_ALIAS"],
		[
			'<Form id="f" defaultLanguage="Kalada"><Output id="x" value={unknown}/></Form>',
			"KALADA_SYNTAX_UNKNOWN_REFERENCE",
		],
		['<Form id="f" defaultLanguage="Kalada"><Unknown id="x"/></Form>', "UNKNOWN_ELEMENT"],
	])("fails closed: %s", (text, code) => {
		const { options } = fixture();
		const result = compileFsx(text, options);
		expect(result).toMatchObject({ ok: false, diagnostics: [{ code }] });
		expect(result).not.toHaveProperty("definition");
		if (result.ok) return;
		expect(result.diagnostics[0]?.path).toBeTruthy();
		expect(result.diagnostics[0]?.range).toBeDefined();
	});
	it("lets the guest own quoted braces and refuses failed-guest sibling recovery", () => {
		const { options } = fixture();
		expect(
			compileFsx(`<Form id="f" defaultLanguage="Kalada"><Output id="o" value={"}😀"}/></Form>`, options),
		).toMatchObject({ ok: true });
		const text = `<Form id="f" defaultLanguage="Kalada"><Output id="o" value={name => evil}/><Output id="sibling" value={name}/></Form>`;
		const result = compileFsx(text, options);
		expect(result.ok).toBe(false);
		expect(result).not.toHaveProperty("definition");
	});
	it("rejects accessor metadata without invoking it", () => {
		const { options } = fixture();
		const getter = vi.fn(() => options.references);
		const unsafe = Object.defineProperty({ ...options }, "references", { get: getter });
		expect(compileFsx(source, unsafe)).toMatchObject({ ok: false, diagnostics: [{ code: "ACCESSOR_METADATA" }] });
		expect(getter).not.toHaveBeenCalled();
	});
	it("admits checked bare primitive row line, but denies optional/computed whole-row writes", () => {
		const { options } = fixture();
		const primitive = {
			...options,
			items: {
				line: {
					target: { namespace: "data" as const, scope: "line", segments: [] },
					type: { kind: "primitive-type" as const, name: "string" as const },
					writable: true as const,
				},
			},
			admission: {
				...options.admission,
				policy: {
					...options.admission.identity,
					namespaces: { data: "available" },
					widgets: {},
					renderers: {},
					actions: {},
					schema: {
						side: "input",
						availability: "complete",
						paths: [
							{ path: ["rows"], kind: "array" },
							{ path: ["rows", { row: "line" }], kind: "value" },
						],
					},
					ui: { availability: "complete", paths: [] },
				},
			},
		};
		const text = `<Form id="f" defaultLanguage="Kalada"><Repeater id="rows" value={rows} as="line"><Field id="item" value={line} widget="text"/></Repeater></Form>`;
		const result = compileFsx(text, primitive);
		expect(result, JSON.stringify(result)).toMatchObject({
			ok: true,
			definition: {
				root: {
					children: [{ scope: "line", children: [{ binding: { namespace: "data", scope: "line", segments: [] } }] }],
				},
			},
		});
		for (const write of ["line?.x", "line + 1", "line[0]"])
			expect(compileFsx(text.replace("value={line}", `value={${write}}`), primitive)).toMatchObject({ ok: false });
	});
	it("checks supplied computation cycles without evaluating them and omits unmapped ranges", () => {
		const { options, host } = fixture();
		const capture = vi.spyOn(host.strategy, "capture");
		const ref = { namespace: "data" as const, segments: ["profile", "name"] };
		const result = compileFsx(`<Form id="f" defaultLanguage="Kalada"/>`, {
			...options,
			computations: [
				{
					id: "cycle",
					target: ref,
					expression: { format: "kalada-program", version: 1, profile: "kalada-v1", expression: { kind: "ref", ref } },
				},
			],
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.diagnostics[0]?.path).toContain("computations");
		expect(result.diagnostics[0]).not.toHaveProperty("range");
		expect(capture).not.toHaveBeenCalled();
	});
	it.each([
		['renderer="Editor"', 'renderer="untrusted"', "UNTRUSTED_RENDERER"],
		['title="Edit"', "title={name}", "STATIC_LITERAL_REQUIRED"],
		["current={name}", "current={1}", "PROP_TYPE_MISMATCH"],
		["edit={name}", "edit={name + 1}", "KALADA_SYNTAX_WRITE_INELIGIBLE"],
	])("rejects untrusted or mismatched custom props %s", (from, to, code) => {
		const { options } = fixture();
		expect(compileFsx(source.replace(from, to), options)).toMatchObject({ ok: false, diagnostics: [{ code }] });
	});
	it("maps malformed conditional guests to the actual then declaration and stops before siblings", () => {
		const { options } = fixture();
		const text = `<Form id="f" defaultLanguage="Kalada"><Conditional id="c" condition={true}><Field id="x" widget="text" value={name => evil}/></Conditional></Form>`;
		const result = compileFsx(text, options);
		expect(result).toMatchObject({ ok: false, diagnostics: [{ path: "root.children[0].then[0].binding" }] });
	});
});
