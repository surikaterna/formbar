import type { JsonValue, StateRef } from "@formbar/expressions";
import type { KaladaV1Program } from "@kalada/core";
import type { Binding } from "../bindings.js";
import type { ActionConcurrency, OutputFormat } from "../nodes.js";
import type { NodePresentation } from "../presentation.js";
import type { KaladaReference } from "./kalada-program.js";

// Future private definition shape; admission does not yet change the public Kuery definition.
export type KaladaSlot = KaladaV1Program<KaladaReference>;
export type KaladaProps = Readonly<
	Record<
		string,
		| { readonly mode: "literal"; readonly value: JsonValue }
		| { readonly mode: "read"; readonly expression: KaladaSlot }
		| {
				readonly mode: "write";
				readonly reference: StateRef & { readonly namespace: "data" };
				readonly expression?: never;
		  }
	>
>;

interface BaseNode {
	readonly id: string;
	readonly visible?: KaladaSlot;
	readonly disabled?: KaladaSlot;
	readonly readOnly?: KaladaSlot;
	readonly presentation?: NodePresentation;
}

export type KaladaNode =
	| (BaseNode & { readonly type: "group"; readonly label?: string; readonly children: readonly KaladaNode[] })
	| (BaseNode & {
			readonly type: "section";
			readonly title?: string;
			readonly description?: string;
			readonly children: readonly KaladaNode[];
	  })
	| (BaseNode & {
			readonly type: "field";
			readonly binding: Binding;
			readonly widget: string;
			readonly label?: string;
			readonly required?: KaladaSlot;
			readonly props?: KaladaProps;
			readonly submitWhenHidden?: "include";
	  })
	| (BaseNode & {
			readonly type: "repeater";
			readonly binding: Binding;
			readonly scope: string;
			readonly label?: string;
			readonly children: readonly KaladaNode[];
			readonly minItems?: number;
			readonly maxItems?: number;
	  })
	| (BaseNode & {
			readonly type: "action";
			readonly action: string;
			readonly label?: string;
			readonly payload?: KaladaSlot;
			readonly concurrency?: ActionConcurrency;
			readonly target?: Binding;
			readonly props?: KaladaProps;
	  })
	| (BaseNode & {
			readonly type: "output";
			readonly value: KaladaSlot;
			readonly label?: string;
			readonly format?: OutputFormat;
			readonly props?: KaladaProps;
	  })
	| (BaseNode & {
			readonly type: "conditional";
			readonly condition: KaladaSlot;
			readonly then: readonly KaladaNode[];
			readonly else?: readonly KaladaNode[];
	  })
	| (BaseNode & {
			readonly type: "tabs";
			readonly tabs: readonly KaladaCollection[];
	  })
	| (BaseNode & {
			readonly type: "accordion";
			readonly items: readonly KaladaCollection[];
	  })
	| (BaseNode & { readonly type: "validation"; readonly binding: Binding; readonly messages?: readonly string[] })
	| (BaseNode & {
			readonly type: "custom";
			readonly renderer: string;
			readonly props?: KaladaProps;
			readonly children?: readonly KaladaNode[];
	  });

export interface KaladaCollection {
	readonly id: string;
	readonly label: string;
	readonly children: readonly KaladaNode[];
}

export interface KaladaDefinition {
	readonly version: 1;
	readonly id: string;
	readonly root: KaladaNode;
	readonly computations?: readonly {
		readonly id: string;
		readonly target: Binding;
		readonly expression: KaladaSlot;
	}[];
	readonly submission?: { readonly hiddenValues: "include" | "omit-inactive" };
}
