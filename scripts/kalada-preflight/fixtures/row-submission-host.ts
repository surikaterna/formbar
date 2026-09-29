import { type JsonValue, copyJson } from "@formbar/expressions";
import type {
	DataContext,
	FormbarDataStrategyV1,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import type { FormField, Node, TreeNode } from "./row-write-hosts.js";

type State = { revision: object; field: FormField; data: JsonValue };

export function rowData(field: FormField, roots: readonly TreeNode[]): JsonValue {
	return {
		profile: { name: field.value },
		rows: roots.map((root) => ({
			value: root.value,
			nested: root.children.map((child) => ({ value: child.value, quantity: child.quantity })),
		})),
	};
}

export function registryData(field: FormField, roots: readonly string[], nodes: ReadonlyMap<string, Node>): JsonValue {
	return {
		profile: { name: field.value },
		rows: roots.map((id) => {
			const root = nodes.get(id) as Node;
			return {
				value: root.value,
				nested: root.children.map((childId) => {
					const child = nodes.get(childId) as Node;
					return { value: child.value, quantity: child.quantity };
				}),
			};
		}),
	};
}

export function submissionPorts(state: (context: DataContext) => State) {
	const submissions: JsonValue[] = [];
	let handoff: () => Promise<void> = async () => {};
	const ports: Pick<FormbarDataStrategyV1, "captureSubmission" | "submitCaptured"> = {
		captureSubmission(context) {
			const current = state(context);
			if (current.field.missing) return { status: "missing" };
			if (current.field.denied || current.field.readOnly) return { status: "denied" };
			return { status: "found", instance: context.instance, revision: current.revision, data: copyJson(current.data) };
		},
		async submitCaptured(context, request, fresh) {
			await handoff();
			const current = state(context);
			if (!fresh()) return { status: "stale" };
			if (request.instance !== context.instance || request.revision !== current.revision) return { status: "stale" };
			if (current.field.missing) return { status: "missing" };
			if (current.field.denied || current.field.readOnly) return { status: "denied" };
			if (JSON.stringify(request.data) !== JSON.stringify(current.data)) return { status: "conflict" };
			submissions.push(copyJson(request.data));
			return { status: "submitted" };
		},
	};
	return {
		ports,
		submissions,
		setHandoff: (next: () => Promise<void>) => {
			handoff = next;
		},
	};
}
