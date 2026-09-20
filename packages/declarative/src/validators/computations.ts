import { dependencyKey } from "@formbar/expressions";
import type { JsonValue, StateRef } from "@formbar/expressions";
import type { StoredComputation } from "../computations.js";
import type { DiagnosticPathSegment } from "../diagnostics.js";
import { binding } from "./bindings.js";
import { type ValidationContext, diagnostic } from "./context.js";
import { expression } from "./expressions.js";
import { array, exactKeys, identifier, record } from "./shape.js";

interface ComputationEntry {
	readonly computation: StoredComputation;
	readonly dependencies: readonly StateRef[];
	readonly index: number;
}

export function computations(
	value: JsonValue | undefined,
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): readonly StoredComputation[] | undefined {
	if (value === undefined) return undefined;
	const values = array(value, path, context);
	if (!values) return undefined;
	const entries = values
		.map((item, index) => computation(item, [...path, index], index, context))
		.filter((entry): entry is ComputationEntry => Boolean(entry));
	checkUnique(entries, path, context);
	checkGraph(entries, path, context);
	return entries.length === values.length ? Object.freeze(entries.map(({ computation: item }) => item)) : undefined;
}

function computation(
	value: JsonValue,
	path: readonly DiagnosticPathSegment[],
	index: number,
	context: ValidationContext,
): ComputationEntry | undefined {
	const source = record(value, path, context);
	if (!source) return undefined;
	exactKeys(source, new Set(["id", "target", "expression"]), path, context);
	const id = identifier(source.id, [...path, "id"], context);
	const target = binding(source.target, [...path, "target"], {}, context);
	const parsed = expression(source.expression, [...path, "expression"], {}, context);
	if (!id || !target || !parsed) return undefined;
	return {
		index,
		computation: Object.freeze({ id, target, expression: parsed.expression }),
		dependencies: parsed.program.dependencies,
	};
}

function checkUnique(
	entries: readonly ComputationEntry[],
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): void {
	const ids = new Set<string>();
	const targets = new Set<string>();
	for (const { computation: item, dependencies, index } of entries) {
		if (ids.has(item.id))
			diagnostic(context, "duplicate-computation-id", [...path, index, "id"], `Duplicate computation ID '${item.id}'.`);
		ids.add(item.id);
		const target = dependencyKey(item.target);
		if (targets.has(target))
			diagnostic(context, "duplicate-computation-target", [...path, index, "target"], "Duplicate computation target.");
		targets.add(target);
		if (dependencies.some((dependency) => dependencyKey(dependency) === target))
			diagnostic(
				context,
				"self-dependency",
				[...path, index, "expression"],
				`Computation '${item.id}' depends on itself.`,
			);
	}
}

function checkGraph(
	entries: readonly ComputationEntry[],
	path: readonly DiagnosticPathSegment[],
	context: ValidationContext,
): void {
	const owners = new Map(entries.map((entry) => [dependencyKey(entry.computation.target), entry.index]));
	const edges = new Map<number, readonly number[]>();
	for (const entry of entries) {
		const linked = entry.dependencies
			.map((dependency) => owners.get(dependencyKey(dependency)))
			.filter((index): index is number => index !== undefined && index !== entry.index);
		edges.set(entry.index, Object.freeze([...new Set(linked)].sort((left, right) => left - right)));
	}
	const cyclic = cyclicVertices(
		entries.map(({ index }) => index),
		edges,
	);
	for (const index of [...cyclic].sort((left, right) => left - right))
		diagnostic(context, "computation-cycle", [...path, index, "expression"], "Computation dependency cycle detected.");
}

function cyclicVertices(
	vertices: readonly number[],
	edges: ReadonlyMap<number, readonly number[]>,
): ReadonlySet<number> {
	const visited = new Set<number>();
	const active = new Set<number>();
	const stack: number[] = [];
	const cyclic = new Set<number>();
	const visit = (vertex: number): void => {
		if (visited.has(vertex)) return;
		visited.add(vertex);
		active.add(vertex);
		stack.push(vertex);
		for (const next of edges.get(vertex) ?? []) {
			if (!visited.has(next)) visit(next);
			else if (active.has(next)) markCycle(stack, next, cyclic);
		}
		stack.pop();
		active.delete(vertex);
	};
	for (const vertex of vertices) visit(vertex);
	return cyclic;
}

function markCycle(stack: readonly number[], start: number, cyclic: Set<number>): void {
	for (const member of stack.slice(stack.indexOf(start))) cyclic.add(member);
}
