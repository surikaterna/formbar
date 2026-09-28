import { vi } from "vitest";
import type {
	DataContext,
	DirectWriteRequest,
	FormbarDataStrategyV1,
	ReadScope,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { KALADA_RUNTIME_ARTIFACT } from "../../../packages/declarative/src/validators/kalada-private-runtime.js";

export type Node = {
	id: string;
	token: object;
	revision: object;
	value: string;
	children: string[];
	denied: boolean;
	readOnly: boolean;
};
export const node = (id: string, value: string): Node => ({
	id,
	token: {},
	revision: {},
	value,
	children: [],
	denied: false,
	readOnly: false,
});
export type TreeNode = Omit<Node, "children"> & { children: TreeNode[] };
export type TreeState = { revision: object; roots: TreeNode[]; notify: () => void };
export type RegistryVersion = { revision: object; roots: string[]; nodes: Map<string, Node> };
export type RegistryState = { version: RegistryVersion; notify: () => void };
export const receipt = () => ({ artifact: KALADA_RUNTIME_ARTIFACT, policyGeneration: "g1", policyFingerprint: "host" });
export const referencePath = ["rows", { row: "outer" }, "nested", { row: "inner" }, "value"];

export function validTarget(request: DirectWriteRequest, context: DataContext) {
	if (request.expectedInstance !== context.instance || request.contract !== "formbar-direct-write-v1") return "stale";
	if (request.scope.rows.map((row) => row.name).join("/") !== "outer/inner") return "invalid-target";
	if (
		request.reference.namespace !== "data" ||
		JSON.stringify(request.reference.path) !== JSON.stringify(referencePath)
	)
		return "invalid-target";
	return undefined;
}

export function serialHost() {
	const states = new Map<object, TreeState>();
	const notifications = vi.fn();
	const state = (context: DataContext) => {
		const result = states.get(context.instance);
		if (!result) throw new Error("foreign instance");
		return result;
	};
	const make = (id: string, value: string): TreeNode => ({ ...node(id, value), children: [] });
	const resolve = (current: TreeState, scope: ReadScope) => {
		let siblings = current.roots;
		let found: TreeNode | undefined;
		for (const binding of scope.rows) {
			const matches = siblings.filter((candidate) => candidate.token === binding.token);
			if (matches.length !== 1) return undefined;
			found = matches[0];
			siblings = found?.children ?? [];
		}
		return found;
	};
	const bump = (current: TreeState) => {
		current.revision = {};
		current.notify();
	};
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity(context) {
			if (!states.has(context.instance)) {
				const first = make("first", "first");
				first.children.push(make("child", "child"));
				states.set(context.instance, {
					revision: {},
					roots: [first, make("second", "second")],
					notify: () => notifications(),
				});
			}
			return receipt();
		},
		capture(context) {
			const current = state(context);
			const token = current.revision;
			return {
				instance: context.instance,
				token,
				read(_reference, scope) {
					if (current.revision !== token) return { status: "stale" };
					const found = resolve(current, scope);
					return found ? { status: "found", value: found.value } : { status: "missing" };
				},
				enumerateRows(parent, _binding, name) {
					if (current.revision !== token) return { status: "stale" };
					const source = name === "outer" ? current.roots : resolve(current, parent)?.children;
					return source
						? {
								status: "found",
								rows: source.map((item, order) => ({
									token: item.token,
									writeRevision: item.revision,
									order,
									scope: { rows: [...parent.rows, { name, token: item.token }] },
								})),
							}
						: { status: "missing" };
				},
			};
		},
		current: (context) => state(context).revision,
		subscribe(context, notify) {
			state(context).notify = notify;
			return () => {
				state(context).notify = () => {};
			};
		},
		writeDirect(context, request) {
			const current = state(context);
			const invalid = validTarget(request, context);
			if (invalid) return { status: invalid };
			if (request.expectedRevision !== current.revision) return { status: "stale" };
			const parent = resolve(current, { rows: request.scope.rows.slice(0, 1) });
			const child = resolve(current, request.scope);
			if (!parent || !child) return { status: "missing" };
			if (parent.denied || child.denied || parent.readOnly || child.readOnly) return { status: "denied" };
			if (child.revision !== request.expectedRowRevision) return { status: "conflict" };
			if (typeof request.value !== "string") return { status: "invalid-target" };
			// Serial critical section: validation and mutation are synchronous with no callback until commit.
			child.value = request.value;
			child.revision = {};
			bump(current);
			return { status: "applied" };
		},
	};
	return { strategy, states, notifications, bump };
}

export function versionedHost() {
	const states = new Map<object, RegistryState>();
	const notifications = vi.fn();
	const state = (context: DataContext) => {
		const result = states.get(context.instance);
		if (!result) throw new Error("foreign instance");
		return result;
	};
	const resolve = (version: RegistryVersion, scope: ReadScope) => {
		let ids = version.roots;
		let found: Node | undefined;
		for (const binding of scope.rows) {
			const matches = ids.map((id) => version.nodes.get(id)).filter((item) => item?.token === binding.token);
			if (matches.length !== 1) return undefined;
			found = matches[0];
			ids = found?.children ?? [];
		}
		return found;
	};
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity(context) {
			if (!states.has(context.instance)) {
				const first = { ...node("first", "first"), children: ["child"] };
				states.set(context.instance, {
					version: {
						revision: {},
						roots: ["first", "second"],
						nodes: new Map([
							["first", first],
							["second", node("second", "second")],
							["child", node("child", "child")],
						]),
					},
					notify: () => notifications(),
				});
			}
			return receipt();
		},
		capture(context) {
			const owner = state(context);
			const version = owner.version;
			return {
				instance: context.instance,
				token: version.revision,
				read(_reference, scope) {
					if (owner.version !== version) return { status: "stale" };
					const found = resolve(version, scope);
					return found ? { status: "found", value: found.value } : { status: "missing" };
				},
				enumerateRows(parent, _binding, name) {
					if (owner.version !== version) return { status: "stale" };
					const ids = name === "outer" ? version.roots : resolve(version, parent)?.children;
					return ids
						? {
								status: "found",
								rows: ids.map((id, order) => {
									const item = version.nodes.get(id) as Node;
									return {
										token: item.token,
										writeRevision: item.revision,
										order,
										scope: { rows: [...parent.rows, { name, token: item.token }] },
									};
								}),
							}
						: { status: "missing" };
				},
			};
		},
		current: (context) => state(context).version.revision,
		subscribe(context, notify) {
			state(context).notify = notify;
			return () => {
				state(context).notify = () => {};
			};
		},
		writeDirect(context, request) {
			const owner = state(context);
			const version = owner.version;
			const invalid = validTarget(request, context);
			if (invalid) return { status: invalid };
			if (request.expectedRevision !== version.revision) return { status: "stale" };
			const parent = resolve(version, { rows: request.scope.rows.slice(0, 1) });
			const child = resolve(version, request.scope);
			if (!parent || !child) return { status: "missing" };
			if (parent.denied || child.denied || parent.readOnly || child.readOnly) return { status: "denied" };
			if (child.revision !== request.expectedRowRevision) return { status: "conflict" };
			if (typeof request.value !== "string") return { status: "invalid-target" };
			// No old node or version is modified before the single owner pointer swap.
			const nodes = new Map(version.nodes);
			nodes.set(child.id, { ...child, value: request.value, revision: {} });
			owner.version = { revision: {}, roots: version.roots, nodes };
			owner.notify();
			return { status: "applied" };
		},
	};
	return {
		strategy,
		states,
		notifications,
		change(instance: object, edit: (draft: RegistryVersion) => void) {
			const owner = states.get(instance);
			if (!owner) throw new Error("foreign instance");
			const draft = {
				revision: {},
				roots: [...owner.version.roots],
				nodes: new Map([...owner.version.nodes].map(([id, item]) => [id, { ...item, children: [...item.children] }])),
			};
			edit(draft);
			owner.version = draft;
			owner.notify();
		},
	};
}
