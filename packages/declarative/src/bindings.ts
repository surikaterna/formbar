import type { Segment, StateRef } from "@formbar/expressions";

export type PathSegment = Segment;

export type AbsoluteBinding = StateRef & {
	readonly scope?: never;
};

export type ScopedBinding = StateRef & {
	readonly scope: string;
};

/** A structured state path, optionally relative to a lexically enclosing repeater scope. */
export type Binding = AbsoluteBinding | ScopedBinding;
