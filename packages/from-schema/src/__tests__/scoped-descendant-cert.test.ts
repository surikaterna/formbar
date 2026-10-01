import { expect, test } from "vitest";
import { hostSchema, validationHost } from "./kalada-validation-host-408.js";

test("schema descendant issue remains on its concrete child, never retargets to ancestor", async () => {
	const schema = {
		...hostSchema,
		properties: {
			...hostSchema.properties,
			profile: { type: "object", additionalProperties: false, properties: { name: { type: "string", minLength: 30 } } },
		},
	};
	const fixture = validationHost(schema);
	try {
		const state = fixture.installed.instances.values().next().value;
		if (!state?.validators) throw Error("missing installed validators");
		const results = (
			await Promise.all(
				state.validators.map((validator) => validator(fixture.host.snapshot().data, new AbortController().signal)),
			)
		).flat();
		expect(results).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: ["profile", "name"], source: "schema" })]),
		);
		expect(results).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: ["profile"] })]));
		expect(await fixture.host.submit()).toEqual({ status: "denied" });
		expect(state.outgoing).toBeUndefined();
	} finally {
		fixture.host.dispose();
	}
});

test("extension descendant and ancestor paths retain their own provenance and order", async () => {
	const fixture = validationHost(undefined, {
		validators: [
			async () => [
				{ path: ["profile"], source: "extension", message: "parent" },
				{ path: ["profile", "name"], source: "extension", message: "child" },
			],
		],
	});
	try {
		const state = fixture.installed.instances.values().next().value;
		if (!state) throw Error("missing installed instance");
		expect(await fixture.host.submit()).toEqual({ status: "denied" });
		expect(state.issueRecords.map(({ path, source, message }) => ({ path, source, message }))).toEqual([
			{ path: ["profile"], source: "extension", message: "parent" },
			{ path: ["profile", "name"], source: "extension", message: "child" },
		]);
		expect(state.outgoing).toBeUndefined();
	} finally {
		fixture.host.dispose();
	}
});

test("typed extension issue paths preserve string '0' separately from a numeric row index", async () => {
	const fixture = validationHost(undefined, {
		validators: [
			async () => [
				{ path: ["rows", 0, "nested", 0, "quantity"], source: "extension", message: "row" },
				{ path: ["rows", "0", "nested", "0", "quantity"], source: "extension", message: "literal" },
			],
		],
	});
	try {
		const state = fixture.installed.instances.values().next().value;
		if (!state) throw Error("missing installed instance");
		expect(await fixture.host.submit()).toEqual({ status: "denied" });
		expect(state.issueRecords.map((issue) => issue.path)).toEqual([
			["rows", 0, "nested", 0, "quantity"],
			["rows", "0", "nested", "0", "quantity"],
		]);
		expect(state.outgoing).toBeUndefined();
	} finally {
		fixture.host.dispose();
	}
});
