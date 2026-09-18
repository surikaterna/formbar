import { PassThrough } from "node:stream";
import { createForm } from "@formbar/core";
import type { SchemaFormResult } from "@formbar/from-schema";
import { expect, it, vi } from "vitest";

vi.mock("ink", async (importActual) => ({
	...(await importActual<typeof import("ink")>()),
	render: () => {
		throw new Error("partial Ink render");
	},
}));

const { renderStandaloneForm } = await import("../standalone.js");

it("restores partial render setup without transferring host form ownership", () => {
	const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
	const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
	const stderr = new PassThrough() as PassThrough & NodeJS.WriteStream;
	const raw = vi.fn<(enabled: boolean) => NodeJS.ReadStream>(() => stdin);
	Object.assign(stdin, { isTTY: true, setRawMode: raw });
	Object.assign(stdout, { isTTY: true, columns: 80 });
	const form = createForm({ initialData: { name: "Ada" } });
	const schema: SchemaFormResult = {
		fields: [{ path: "name", type: "string", required: true, metadata: {} }],
		layout: { type: "field", id: "name", path: "name" },
		metadata: {},
		validators: [],
		defaults: {},
		optionsByPath: new Map(),
		warnings: [],
	};
	expect(() => renderStandaloneForm({ form, schema, stdin, stdout, stderr, formOwnership: "host" })).toThrow(
		"partial Ink render",
	);
	expect(raw.mock.calls).toEqual([[true], [false]]);
	expect(form.isDisposed()).toBe(false);
	form.dispose();
});
