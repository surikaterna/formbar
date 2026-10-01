import { expect, it } from "vitest";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { createPrivateKaladaRuntime } from "../../../packages/declarative/src/validators/kalada-private-runtime.js";
import { directWriteServer } from "./direct-write-server.js";

const path = "root.binding";
const target = { namespace: "data" as const, segments: ["order", "total"] };
const definition = { version: 1, id: "form", root: { type: "field", id: "total", widget: "number", binding: target } };
const policy = snapshotAdmissionPolicy({
	generation: "g1",
	fingerprint: "host",
	widgets: {},
	renderers: {},
	actions: {},
	namespaces: { data: "available" },
	schema: { side: "input", availability: "complete", paths: [{ path: target.segments, kind: "value" }] },
	ui: { availability: "complete", paths: [] },
});
const bindings = {
	order: {
		target: { namespace: "data" as const, segments: ["order"] },
		type: { kind: "primitive-type" as const, name: "json" as const },
		writable: true as const,
		properties: {
			total: { type: { kind: "primitive-type" as const, name: "number" as const }, writable: true as const },
		},
	},
};

function fixture() {
	const server = directWriteServer();
	const form = createPrivateKaladaRuntime({
		definition,
		policy,
		identity: { generation: "g1", fingerprint: "host" },
		strategy: server.strategy,
		directLocations: { [path]: bindings },
	});
	return { server, form };
}

it("checks static WRITE target and range then sends only that target over the test-only serialized host boundary", () => {
	const { server, form } = fixture();
	expect(form.checkDirectLocation(path, " (order.total) ")).toMatchObject({
		ok: true,
		location: { target, type: { name: "number" }, range: { start: 1, end: 14 } },
	});
	const before = server.state();
	expect(form.writeChecked(path, "order.total", 11)).toEqual({ status: "applied" });
	expect(server.state()).toMatchObject({
		value: 11,
		submitted: { order: { total: 11 }, untouched: "retained" },
		notices: 1,
	});
	expect(server.state().revision).not.toBe(before.revision);
	expect(server.requests).toHaveLength(1);
	expect(JSON.parse(server.requests[0] as string)).toMatchObject({
		contract: "formbar-direct-write-v1",
		targetKind: "non-repeater",
		scope: { rows: [] },
		reference: { namespace: "data", path: ["order", "total"] },
		value: 11,
	});
	expect(server.responses).toEqual(['{"status":"applied"}']);
	form.dispose();
});

it("rejects read/computed/optional/index/dynamic and mismatched targets before transport", () => {
	const { server, form } = fixture();
	const before = server.state();
	for (const source of [
		"order.total + 1",
		"order?.total",
		"order[0]",
		"order.total[0]",
		"other",
		"order",
		"order.missing",
		"order.total()",
	])
		expect(form.writeChecked(path, source, 8), source).toEqual({ status: "invalid-target" });
	expect(form.writeChecked(path, "order.total", () => 8)).toEqual({ status: "invalid-target" });
	expect(form.writeChecked("root.readOnly", "order.total", 8)).toEqual({ status: "invalid-target" });
	expect(server.state()).toEqual(before);
	expect(server.requests).toHaveLength(0);
	form.dispose();
});

it("accepts a bare root alias only with trusted typed target metadata, not as a read result", () => {
	const { server, form } = fixture();
	const bare = createPrivateKaladaRuntime({
		definition,
		policy,
		identity: { generation: "g1", fingerprint: "host" },
		strategy: server.strategy,
		directLocations: {
			[path]: { total: { target, type: { kind: "primitive-type", name: "number" }, writable: true } },
		},
	});
	expect(bare.checkDirectLocation(path, "total")).toMatchObject({
		ok: true,
		location: { target, range: { start: 0, end: 5 } },
	});
	expect(bare.writeChecked(path, "total", 6)).toEqual({ status: "applied" });
	expect(server.state().value).toBe(6);
	bare.dispose();
	form.dispose();
});

it("fails closed on static readOnly metadata and an absent host write port", () => {
	const server = directWriteServer();
	const readOnly = createPrivateKaladaRuntime({
		definition,
		policy,
		identity: { generation: "g1", fingerprint: "host" },
		strategy: server.strategy,
		directLocations: {
			[path]: {
				order: { ...bindings.order, properties: { total: { ...bindings.order.properties.total, writable: false } } },
			},
		},
	});
	expect(readOnly.writeChecked(path, "order.total", 5)).toEqual({ status: "invalid-target" });
	expect(server.requests).toHaveLength(0);
	readOnly.dispose();
	const unsupported = createPrivateKaladaRuntime({
		definition,
		policy,
		identity: { generation: "g1", fingerprint: "host" },
		strategy: { ...server.strategy, writeDirect: undefined },
		directLocations: { [path]: bindings },
	});
	expect(unsupported.writeChecked(path, "order.total", 5)).toEqual({ status: "unsupported" });
	expect(server.state().value).toBe(4);
	unsupported.dispose();
});

it("host rechecks current grant, readOnly, removal, type, revision and conflict without changing submission", () => {
	const { server, form } = fixture();
	const attempt = (status: string, run: () => unknown) => {
		const before = server.state();
		expect(run()).toEqual({ status });
		expect(server.state()).toEqual(before);
	};
	server.setGrant(false);
	attempt("denied", () => form.writeChecked(path, "order.total", 9));
	server.setGrant(true);
	server.setReadOnly(true);
	attempt("denied", () => form.writeChecked(path, "order.total", 9));
	server.setReadOnly(false);
	server.setRemoved(true);
	attempt("missing", () => form.writeChecked(path, "order.total", 9));
	server.setRemoved(false);
	server.setConflict(true);
	attempt("conflict", () => form.writeChecked(path, "order.total", 9));
	server.setConflict(false);
	attempt("invalid-target", () => form.writeChecked(path, "order.total", "wrong"));
	attempt("invalid-target", () => form.writeChecked(path, "order.total", 101));
	const before = server.state();
	expect(
		server.host(
			JSON.stringify({
				contract: "formbar-direct-write-v1",
				targetKind: "non-repeater",
				instance: "form-1",
				revision: 1,
				scope: { rows: [] },
				reference: { namespace: "data", path: ["order", "total"] },
				value: "wrong",
			}),
		),
	).toBe('{"status":"invalid-target"}');
	expect(server.state()).toEqual(before);
	for (const reference of [
		{ namespace: "ui", path: ["order", "total"] },
		{ namespace: "data", path: ["other", "total"] },
		{ namespace: "data", path: ["order", 0, "total"] },
	]) {
		const wire = JSON.stringify({
			contract: "formbar-direct-write-v1",
			targetKind: "non-repeater",
			instance: "form-1",
			revision: 1,
			scope: { rows: [] },
			reference,
			value: 9,
		});
		expect(JSON.parse(server.host(wire))).toEqual({ status: "invalid-target" });
		expect(server.state()).toEqual(before);
	}
	server.rotate();
	attempt("stale", () =>
		JSON.parse(
			server.host(
				JSON.stringify({
					contract: "formbar-direct-write-v1",
					targetKind: "non-repeater",
					instance: "form-1",
					revision: 1,
					scope: { rows: [] },
					reference: { namespace: "data", path: ["order", "total"] },
					value: 9,
				}),
			),
		),
	);
	form.dispose();
	attempt("stale", () => form.writeChecked(path, "order.total", 9));
});

it("rejects malformed and forged serialized requests without mutation or notification", () => {
	const { server, form } = fixture();
	const valid = {
		contract: "formbar-direct-write-v1",
		targetKind: "non-repeater",
		instance: "form-1",
		revision: 1,
		reference: { namespace: "data", path: ["order", "total"] },
		scope: { rows: [] },
		value: 9,
	};
	const before = server.state();
	const requests = server.requests.length;
	for (const wire of [
		"{",
		"null",
		"[]",
		"42",
		"true",
		" ".repeat(4097),
		...[
			{ value: undefined },
			{ value: null },
			{ value: "9" },
			{ value: -1 },
			{ targetKind: "row" },
			{ targetKind: "readOnly" },
			{ reference: null },
			{ reference: { namespace: "ui", path: ["order", "total"] } },
			{ reference: { namespace: "data", path: ["order", "total"], extra: 1 } },
			{ reference: { namespace: "data", path: ["order", "total", "__proto__"] } },
			{ scope: { rows: [{ name: "row" }] } },
			{ scope: { rows: [], extra: true } },
			{ revision: null },
			{ revision: "1" },
			{ contract: "forged" },
		].map((change) => JSON.stringify({ ...valid, ...change })),
		JSON.stringify({ ...valid, extra: true }),
		'{"contract":"formbar-direct-write-v1","__proto__":{"status":"applied"}}',
	]) {
		expect(server.host(wire), wire).toBe('{"status":"invalid-target"}');
		expect(server.state(), wire).toEqual(before);
		expect(server.requests, wire).toHaveLength(requests);
	}
	expect(form.writeChecked(path, "order.total", 5)).toEqual({ status: "applied" });
	form.dispose();
});

it("fails closed on corrupt serialized server responses without applying client or host state", () => {
	const { server, form } = fixture();
	for (const wire of [
		"{",
		"null",
		"[]",
		"false",
		" ".repeat(4097),
		"{}",
		'{"status":"applied","extra":true}',
		'{"status":"unknown"}',
		'{"status":null}',
		'{"__proto__":{"status":"applied"}}',
	]) {
		const before = server.state();
		const responses = server.responses.length;
		server.setResponse(wire);
		expect(form.writeChecked(path, "order.total", 9), wire).toEqual({ status: "denied" });
		expect(server.state(), wire).toEqual(before);
		expect(server.responses, wire).toHaveLength(responses);
	}
	form.dispose();
});
