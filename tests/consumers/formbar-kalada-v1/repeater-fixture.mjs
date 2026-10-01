import assert from "node:assert/strict";
import { KALADA_V1_ARTIFACT, createKaladaV1Host } from "@formbar/declarative";

const ref = (segments, scope) => ({ namespace: "data", segments, ...(scope ? { scope } : {}) });
const literal = (value) => ({
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value },
});
const action = (id, name, target, payload, disabled = false) => ({
	type: "action",
	id,
	label: id,
	action: name,
	target,
	...(payload === undefined ? {} : { payload: literal(payload) }),
	...(disabled ? { disabled: literal(true) } : {}),
});

function collection(id, target, options) {
	const scope = `${id}-item`;
	return {
		type: "group",
		id: `${id}-group`,
		children: [
			{
				type: "repeater",
				id,
				binding: target,
				scope,
				maxItems: 10,
				children: [
					{ type: "field", id: `${id}-value`, widget: "text", binding: ref([], scope) },
					action(`${id}-remove`, "array.remove", target),
					action(`${id}-move`, "array.move", target, {}),
					action(`${id}-swap`, "array.swap", target, {}),
				],
			},
			action(`${id}-insert`, "array.insert", target, "inserted"),
			...(options.append === false ? [] : [action(`${id}-append`, "array.append", target, "added", options.disabled)]),
		],
	};
}

export function repeaterFixture(options = {}) {
	const metrics = { captures: 0, reads: 0, enumerations: 0, submissions: 0 };
	const scale = options.rows;
	const nested = options.nested;
	const data = scale
		? { rows: Array.from({ length: scale }, (_, i) => String(i)) }
		: nested
			? { groups: [{ values: ["a", "b"] }, { values: ["other"] }] }
			: { rows: options.values ?? ["a", "b"] };
	let definition;
	if (scale) {
		const scope = "item";
		const children = Array.from({ length: 5 }, (_, i) => ({
			type: "field",
			id: `value-${i}`,
			widget: "text",
			binding: ref([], scope),
		}));
		if (options.outputs)
			children.push(
				...Array.from({ length: 5 }, (_, i) => ({
					type: "output",
					id: `output-${i}`,
					value: {
						format: "kalada-program",
						version: 1,
						profile: "kalada-v1",
						expression: { kind: "ref", ref: ref([], scope) },
					},
				})),
			);
		definition = {
			version: 1,
			id: "scaling",
			root: { type: "repeater", id: "rows", scope, binding: ref(["rows"]), maxItems: 1000, children },
		};
	} else {
		const children = [collection("rows", nested ? ref(["values"], "group") : ref(["rows"]), options)];
		if (options.duplicate)
			children.push(collection("duplicate", nested ? ref(["values"], "group") : ref(["rows"]), options));
		const concrete = options.duplicate ? children.flatMap((group) => group.children) : children;
		definition = {
			version: 1,
			id: "focus",
			root: nested
				? {
						type: "repeater",
						id: "groups",
						scope: "group",
						binding: ref(["groups"]),
						maxItems: 10,
						children: [...concrete, action("groups-move", "array.move", ref(["groups"]), {})],
					}
				: { type: "group", id: "root", children: concrete },
		};
	}
	const identity = { generation: "repeater", fingerprint: "owned" };
	let owner;
	let revision = {};
	let live = true;
	let deny = false;
	const listeners = new Set();
	const arrays = new WeakMap();
	const granted = (ctx) =>
		live &&
		ctx.instance === owner &&
		ctx.policyGeneration === identity.generation &&
		ctx.policyFingerprint === identity.fingerprint;
	const entries = (array) => {
		let list = arrays.get(array);
		if (!list) {
			list = array.map(() => ({ token: {}, revision: {} }));
			arrays.set(array, list);
		}
		return list;
	};
	function locate(reference, scope) {
		if (reference.namespace !== "data") return;
		let value = data;
		for (const segment of reference.path) {
			if (typeof segment === "string") {
				if (!value || !Object.hasOwn(value, segment)) return;
				value = value[segment];
			} else {
				if (!Array.isArray(value)) return;
				const token = scope.rows.find((row) => row.name === segment.row)?.token;
				const index = entries(value).findIndex((entry) => entry.token === token);
				if (index < 0) return;
				value = value[index];
			}
		}
		return value;
	}
	const strategy = {
		contract: "formbar-data-strategy-v1",
		identity(ctx) {
			owner ??= ctx.instance;
			return {
				artifact: KALADA_V1_ARTIFACT,
				policyGeneration: identity.generation,
				policyFingerprint: identity.fingerprint,
			};
		},
		current: (ctx) => (granted(ctx) ? revision : undefined),
		subscribe(ctx, notify) {
			if (!granted(ctx)) return () => {};
			listeners.add(notify);
			return () => listeners.delete(notify);
		},
		capture(ctx) {
			metrics.captures++;
			const token = revision;
			return {
				token,
				instance: owner,
				read(reference, scope) {
					metrics.reads++;
					const value = granted(ctx) && token === revision ? locate(reference, scope) : undefined;
					return value === undefined ? { status: "denied" } : { status: "found", value };
				},
				enumerateRows(parent, binding, name) {
					metrics.enumerations++;
					const array = granted(ctx) && token === revision ? locate(binding, parent) : undefined;
					return Array.isArray(array)
						? {
								status: "found",
								rows: entries(array).map((row, order) => ({
									token: row.token,
									writeRevision: row.revision,
									order,
									scope: { rows: [...parent.rows, { name, token: row.token }] },
								})),
							}
						: { status: "denied" };
				},
			};
		},
		writeDirect() {
			return { status: "denied" };
		},
		captureSubmission(ctx) {
			metrics.submissions++;
			return granted(ctx)
				? { status: "found", instance: owner, revision, data: structuredClone(data) }
				: { status: "denied" };
		},
		submitCaptured() {
			return { status: "denied" };
		},
	};
	const allowedArrays = nested ? [["groups"], ["groups", { row: "group" }, "values"]] : [["rows"]];
	const arrayHost = {
		mutateArray(ctx, request) {
			if (!granted(ctx) || request.instance !== owner || request.revision !== revision) return { status: "stale" };
			if (
				deny ||
				request.contract !== "formbar-array-action-v1" ||
				request.target.namespace !== "data" ||
				!allowedArrays.some((path) => JSON.stringify(path) === JSON.stringify(request.target.path)) ||
				request.minItems !== undefined ||
				request.maxItems !== 10
			)
				return { status: "denied" };
			const parent = request.row ? { rows: request.scope.rows.slice(0, -1) } : request.scope;
			const array = locate(request.target, parent);
			if (!Array.isArray(array)) return { status: "denied" };
			const list = entries(array);
			const find = (row) =>
				row ? list.findIndex((entry) => entry.token === row.token && entry.revision === row.revision) : -1;
			const index = find(request.row);
			const destination = find(request.destination);
			if (
				(request.row && (index < 0 || request.scope.rows.at(-1)?.token !== request.row.token)) ||
				(request.destination && destination < 0)
			)
				return { status: "stale" };
			const insert = request.operation === "array.append" || request.operation === "array.insert";
			if (
				insert &&
				(array.length >= 10 ||
					typeof request.payload !== "string" ||
					(request.operation === "array.insert" && destination < 0))
			)
				return { status: "denied" };
			if (!insert && index < 0) return { status: "denied" };
			if (["array.move", "array.swap"].includes(request.operation) && destination < 0) return { status: "denied" };
			if (!request.operationFence?.complete()) return { status: "stale" };
			if (insert) {
				const at = request.operation === "array.append" ? array.length : destination;
				array.splice(at, 0, request.payload);
				list.splice(at, 0, { token: {}, revision: {} });
			} else if (request.operation === "array.remove") {
				array.splice(index, 1);
				list.splice(index, 1);
			} else if (request.operation === "array.move") {
				array.splice(destination, 0, ...array.splice(index, 1));
				list.splice(destination, 0, ...list.splice(index, 1));
			} else if (request.operation === "array.swap") {
				[array[index], array[destination]] = [array[destination], array[index]];
				[list[index], list[destination]] = [list[destination], list[index]];
			} else return { status: "unsupported" };
			revision = {};
			for (const notify of listeners) notify();
			return { status: "applied" };
		},
	};
	const fields = [];
	const attested = new Map();
	function visit(node, path, scopes = {}) {
		const binding = node.binding;
		const lexical = binding && [...(binding.scope ? scopes[binding.scope] : []), ...binding.segments];
		if (lexical)
			attested.set(JSON.stringify(lexical), { path: lexical, kind: node.type === "repeater" ? "array" : "value" });
		if (node.type === "field") fields.push([`${path}.binding`, node.binding]);
		const next = node.type === "repeater" ? { ...scopes, [node.scope]: [...lexical, { row: node.scope }] } : scopes;
		for (const [i, child] of (node.children ?? []).entries()) visit(child, `${path}.children[${i}]`, next);
	}
	visit(definition.root, "root");
	const host = createKaladaV1Host({
		identity,
		definition,
		strategy,
		policy: {
			...identity,
			widgets: {},
			renderers: {},
			actions: {},
			namespaces: { data: "available" },
			schema: { side: "input", availability: "complete", paths: [...attested.values()] },
			ui: { availability: "complete", paths: [] },
		},
		installed: { arrayHost },
		writeSources: Object.fromEntries(fields.map(([path]) => [path, "line"])),
		directLocations: Object.fromEntries(
			fields.map(([path, target]) => [
				path,
				{
					line: { target, type: { kind: "primitive-type", name: "string" }, writable: true },
					primitiveItem: { scope: target.scope, type: "string", writable: true },
				},
			]),
		),
	});
	return {
		host,
		metrics,
		deny(value) {
			deny = value;
		},
		dispose() {
			host.dispose();
			live = false;
			listeners.clear();
		},
		data() {
			return structuredClone(data);
		},
	};
}

export function instrumentView(host) {
	const counts = { snapshots: 0, controls: 0, outputs: 0, controlGets: 0, outputGets: 0 };
	function measured(array, kind) {
		return new Proxy(array, {
			get(target, key) {
				if (key === "find") throw new Error("Quadratic renderer lookup");
				if (key === Symbol.iterator)
					return function* () {
						for (const entry of target) {
							counts[kind]++;
							yield entry;
						}
					};
				return Reflect.get(target, key);
			},
		});
	}
	const wrapped = {
		...host,
		snapshot() {
			counts.snapshots++;
			const view = host.snapshot();
			return { ...view, controls: measured(view.controls, "controls"), outputs: measured(view.outputs, "outputs") };
		},
	};
	const get = Map.prototype.get;
	return {
		host: wrapped,
		counts,
		start() {
			Map.prototype.get = function (key) {
				const value = get.call(this, key);
				if (value?.rendererId && value?.type === "field") counts.controlGets++;
				else if (value?.format && value?.key && Object.hasOwn(value, "value")) counts.outputGets++;
				return value;
			};
		},
		stop() {
			Map.prototype.get = get;
		},
		assert(size, outputs) {
			assert.deepEqual(counts, {
				snapshots: 1,
				controls: size,
				outputs: outputs ? size : 0,
				controlGets: size,
				outputGets: outputs ? size : 0,
			});
		},
	};
}
