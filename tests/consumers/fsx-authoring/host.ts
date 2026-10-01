import { type FormDefinitionAdmission, type JsonValue, KALADA_V1_ARTIFACT } from "@formbar/declarative";
import { copyJson } from "@formbar/expressions";

type Strategy = FormDefinitionAdmission["strategy"];
type Row = { token: object; revision: object; quantity: string };
const identity = { generation: "fsx-305", fingerprint: "installed-test-host" };

export function installedHost(scopeName = "line", wholeItem = false) {
	let name = "original";
	let revision: object = {};
	let rows: Row[] = [
		{ token: {}, revision: {}, quantity: "first" },
		{ token: {}, revision: {}, quantity: "second" },
	];
	const instances = new Set<object>();
	const listeners = new Set<() => void>();
	const submitted: JsonValue[] = [];
	const calls = { capture: 0, read: 0, write: 0, submit: 0 };
	const data = () => ({ name, rows: rows.map((row) => (wholeItem ? row.quantity : { quantity: row.quantity })) });
	const rowPath = JSON.stringify(["rows", { row: scopeName }, ...(wholeItem ? [] : ["quantity"])]);
	const changed = () => {
		revision = {};
		for (const listener of listeners) listener();
	};
	const granted = (context: Parameters<Strategy["capture"]>[0]) =>
		instances.has(context.instance) &&
		context.policyGeneration === identity.generation &&
		context.policyFingerprint === identity.fingerprint;
	const strategy: Strategy = {
		contract: "formbar-data-strategy-v1",
		identity(context) {
			instances.add(context.instance);
			return {
				artifact: KALADA_V1_ARTIFACT,
				policyGeneration: identity.generation,
				policyFingerprint: identity.fingerprint,
			};
		},
		current: (context) => (granted(context) ? revision : undefined),
		subscribe(context, listener) {
			if (!granted(context)) return () => {};
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		capture(context) {
			calls.capture++;
			const token = revision;
			return {
				instance: context.instance,
				token,
				read(ref, scope) {
					calls.read++;
					if (!granted(context)) return { status: "denied" };
					if (revision !== token) return { status: "stale" };
					if (ref.namespace !== "data") return { status: "denied" };
					if (!scope.rows.length && JSON.stringify(ref.path) === '["name"]') return { status: "found", value: name };
					const row = rows.find((row) => row.token === scope.rows[0]?.token);
					if (scope.rows.length !== 1 || scope.rows[0]?.name !== scopeName || !row) return { status: "missing" };
					if (JSON.stringify(ref.path) === rowPath) return { status: "found", value: row.quantity };
					return { status: "denied" };
				},
				enumerateRows(scope, ref, requestedScope) {
					if (!granted(context)) return { status: "denied" };
					if (revision !== token) return { status: "stale" };
					if (
						scope.rows.length ||
						ref.namespace !== "data" ||
						JSON.stringify(ref.path) !== '["rows"]' ||
						requestedScope !== scopeName
					)
						return { status: "denied" };
					return {
						status: "found",
						rows: rows.map((row, order) => ({
							token: row.token,
							writeRevision: row.revision,
							order,
							scope: { rows: [{ name: scopeName, token: row.token }] },
						})),
					};
				},
			};
		},
		writeDirect(context, request) {
			calls.write++;
			if (!granted(context)) return { status: "denied" };
			if (request.expectedInstance !== context.instance || request.expectedRevision !== revision)
				return { status: "stale" };
			if (typeof request.value !== "string" || request.reference.namespace !== "data")
				return { status: "invalid-target" };
			if (
				request.targetKind === "non-repeater" &&
				!request.scope.rows.length &&
				JSON.stringify(request.reference.path) === '["name"]'
			) {
				name = request.value;
				changed();
				return { status: "applied" };
			}
			if (
				request.targetKind !== (wholeItem ? "row-value" : "row") ||
				request.scope.rows.length !== 1 ||
				request.scope.rows[0]?.name !== scopeName ||
				JSON.stringify(request.reference.path) !== rowPath
			)
				return { status: "denied" };
			const row = rows.find((row) => row.token === request.scope.rows[0]?.token);
			if (!row) return { status: "missing" };
			if (row.revision !== request.expectedRowRevision) return { status: "conflict" };
			row.quantity = request.value;
			row.revision = {};
			changed();
			return { status: "applied" };
		},
		captureSubmission(context) {
			if (!granted(context)) return { status: "denied" };
			return { status: "found", instance: context.instance, revision, data: copyJson(data()) };
		},
		async submitCaptured(context, request, fresh) {
			calls.submit++;
			if (!granted(context)) return { status: "denied" };
			if (!fresh() || request.instance !== context.instance || request.revision !== revision)
				return { status: "stale" };
			if (JSON.stringify(request.data) !== JSON.stringify(data())) return { status: "conflict" };
			submitted.push(copyJson(request.data));
			return { status: "submitted" };
		},
	};
	return {
		identity,
		strategy,
		calls,
		submitted,
		data,
		reorder() {
			rows = [...rows].reverse();
			changed();
		},
		remove() {
			rows = rows.slice(1);
			changed();
		},
	};
}
