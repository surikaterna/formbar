import { expect, it } from "vitest";
import { compileFsx } from "../index.js";
import { fixture } from "./fixture.js";

it.each([
	['<Output id="o" value={name}/><Alias as="name" value={name}/>', "root.children[1].as", '"name"'],
	[
		'<Alias as="a" value={name}/><Output id="o" value={name}/><Alias as="a" value={name}/>',
		"root.children[2].as",
		'"a"',
	],
	[
		'<Output id="o" value={name}/><Alias as="a" value={name}><Alias as="b" value={a}><Output id="inside" value={b}/><Alias as="a" value={b}/></Alias></Alias>',
		"root.children[1].children[0].children[1].as",
		'"a"',
	],
	[
		'<Alias as="a" value={name}><Alias as="b" value={missing}/></Alias>',
		"root.children[0].children[0].value",
		"missing",
	],
	[
		'<Alias as="a" value={name}><Alias as="b" value={name => evil}/></Alias>',
		"root.children[0].children[0].value",
		"=>",
	],
])("retains real Alias construct path independently of emitted counters: %s", (body, path, token) => {
	const { options } = fixture();
	const source = `<Form id="f" defaultLanguage="Kalada">${body}</Form>`;
	const result = compileFsx(source, options);
	expect(result).toMatchObject({ ok: false, diagnostics: [{ path }] });
	if (result.ok) return;
	const range = result.diagnostics[0]?.range;
	expect(range).toBeDefined();
	if (range) expect(source.slice(range.start, range.end)).toContain(token);
	expect(result).not.toHaveProperty("definition");
});

it("emits flattened declaration maps without inventing Alias nodes", () => {
	const { options } = fixture();
	const source =
		'<Form id="f" defaultLanguage="Kalada"><Alias as="a" value={name}/><Output id="first" value={name}/><Alias as="b" value={name}><Alias as="c" value={b}><Output id="second" value={c}/></Alias></Alias></Form>';
	const result = compileFsx(source, options);
	expect(result).toMatchObject({ ok: true, definition: { root: { children: [{ id: "first" }, { id: "second" }] } } });
	if (!result.ok) return;
	for (const [index, token] of [
		[0, "name"],
		[1, "c"],
	] as const) {
		const entry = result.sourceMap.find((entry) => entry.path === `root.children[${index}].value`);
		expect(entry && source.slice(entry.range.start, entry.range.end)).toBe(token);
	}
	expect(result.sourceMap.some((entry) => entry.path.includes(".as"))).toBe(false);
});
