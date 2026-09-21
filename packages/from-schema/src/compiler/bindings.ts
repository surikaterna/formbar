import type { Binding } from "@formbar/declarative";

export interface BindingContext {
	readonly scope?: string;
	readonly segments: readonly (string | number)[];
}

export function binding(context: BindingContext): Binding {
	return Object.freeze({
		namespace: "data",
		segments: Object.freeze([...context.segments]),
		...(context.scope ? { scope: context.scope } : {}),
	});
}

export function childBinding(context: BindingContext, segment: string | number): BindingContext {
	return Object.freeze({ ...context, segments: Object.freeze([...context.segments, segment]) });
}

export function repeaterItemBinding(scope: string): BindingContext {
	return Object.freeze({ scope, segments: Object.freeze([]) });
}
