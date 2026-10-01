/** Return every vertex participating in a cycle, in a graph keyed by declaration index. */
export function cyclicVertices(
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
			if (!visited.has(next)) {
				visit(next);
				continue;
			}
			if (!active.has(next)) continue;
			for (const member of stack.slice(stack.indexOf(next))) cyclic.add(member);
		}
		stack.pop();
		active.delete(vertex);
	};
	for (const vertex of vertices) visit(vertex);
	return cyclic;
}
