import { expect, it, vi } from "vitest";
import { compileFsx } from "../index.js";
import { fixture } from "./fixture.js";

const form = (children: string) => `<Form id="f" defaultLanguage="Kalada">${children}</Form>`;

it.each([
	["", "MISSING_ID", "static id"],
	['id=""', "EMPTY_ID", "nonempty"],
	["id={name}", "NON_STATIC_ID", "double-quoted"],
	...["__proto__", "constructor", "prototype", "x".repeat(257)].map((id) => [`id="${id}"`, "INVALID_ID", "256 UTF-16"]),
])("explains invalid ID %s without emitting a partial definition", (attribute, code, message) => {
	const { options, host } = fixture();
	const capture = vi.spyOn(host.strategy, "capture");
	const text = form(`<Field ${attribute} widget="text" value={name}/>`);
	const result = compileFsx(text, options);
	expect(result).toMatchObject({ ok: false, diagnostics: [{ code, path: "root.children[0].id" }] });
	expect(result).not.toHaveProperty("definition");
	expect(capture).not.toHaveBeenCalled();
	if (result.ok) throw new Error("Expected ID diagnostic");
	const diagnostic = result.diagnostics[0];
	expect(diagnostic.message).toContain(message);
	expect(diagnostic.message).not.toContain("re-author");
	expect(diagnostic.message).not.toContain(code);
	expect(diagnostic.related).toBeUndefined();
	const range = diagnostic.range;
	if (!range) throw new Error("Missing range");
	expect(text.slice(range.start, range.end)).toBe(
		attribute ? attribute.slice(3).replace(/^\{|\}$/gu, "") : '<Field  widget="text" value={name}/>',
	);
});

it.each(["quantity-item", "雪😀", "x".repeat(256), "😀".repeat(128), "with spaces", "<script>"])(
	"retains public V1 identifier %s",
	(id) => {
		const { options } = fixture();
		expect(compileFsx(form(`<Output id=${JSON.stringify(id)} value={name}/>`), options).ok).toBe(true);
	},
);

it.each([
	{
		first: '<Field id="quantity" widget="text" value={name}/>',
		second: '<Field id="quantity" widget="text" value={name}/>',
		firstPath: "root.children[0].id",
		secondPath: "root.children[1].id",
		tag: "Field",
	},
	{
		first: '<Group id="g"><Output id="quantity" value={name}/></Group>',
		second: '<Group id="h"><Output id="quantity" value={name}/></Group>',
		firstPath: "root.children[0].children[0].id",
		secondPath: "root.children[1].children[0].id",
		tag: "Output",
	},
	{
		first: '<Alias as="a" value={name}><Output id="quantity" value={a}/></Alias>',
		second: '<Alias as="b" value={name}><Group id="g"><Output id="quantity" value={b}/></Group></Alias>',
		firstPath: "root.children[0].children[0].id",
		secondPath: "root.children[1].children[0].children[0].id",
		tag: "Output",
	},
])(
	"duplicates point to both physical declarations: $firstPath / $secondPath",
	({ first, second, firstPath, secondPath, tag }) => {
		const { options } = fixture();
		const text = form(`<Output id="astral" value={"😀"}/>${first}${second}`);
		const result = compileFsx(text, options);
		if (result.ok) throw new Error("Expected duplicate diagnostic");
		const diagnostic = result.diagnostics[0];
		// Account for the leading astral-valued sibling without counting code points as offsets.
		const shift = (path: string) =>
			path.replace(/root.children\[(\d+)\]/u, (_, index) => `root.children[${Number(index) + 1}]`);
		expect(diagnostic).toMatchObject({
			code: "DUPLICATE_ID",
			path: shift(secondPath),
			related: [{ path: shift(firstPath) }],
		});
		expect(diagnostic.message).toContain(`already used by <${tag}>`);
		const start = text.indexOf('"quantity"');
		expect(diagnostic.related?.[0].range).toEqual({ start, end: start + '"quantity"'.length });
		const duplicateStart = text.indexOf('"quantity"', start + 1);
		expect(diagnostic.range).toEqual({ start: duplicateStart, end: duplicateStart + '"quantity"'.length });
		expect(result).not.toHaveProperty("definition");
	},
);

it("includes the Form declaration in global uniqueness", () => {
	const { options } = fixture();
	const text = '<Form id="😀" defaultLanguage="Kalada"><Group id="😀"/></Form>';
	const result = compileFsx(text, options);
	expect(result).toMatchObject({
		ok: false,
		diagnostics: [
			{
				code: "DUPLICATE_ID",
				message: expect.stringContaining("<Form>"),
				range: { start: text.lastIndexOf('"😀"'), end: text.lastIndexOf('"😀"') + 4 },
				related: [{ path: "root.id", range: { start: 9, end: 13 } }],
			},
		],
	});
});

it("two distinct element IDs may share the same field location under existing admission ownership", () => {
	const { options } = fixture();
	const result = compileFsx(
		form('<Field id="one" widget="text" value={name}/><Field id="two" widget="text" value={name}/>'),
		options,
	);
	expect(result).toMatchObject({ ok: true });
	if (!result.ok) throw new Error("Expected existing shared-field admission");
	expect(result.definition.root).toMatchObject({
		children: [
			{ id: "one", binding: { segments: ["profile", "name"] } },
			{ id: "two", binding: { segments: ["profile", "name"] } },
		],
	});
});
