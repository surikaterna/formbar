import type { Expression, PropDefinitions } from "@formbar/expressions";
import type { Binding } from "./bindings.js";
import type { NodePresentation } from "./presentation.js";

export type ExtensionProps = PropDefinitions;

export interface BaseNode {
	readonly id: string;
	readonly visible?: Expression;
	readonly disabled?: Expression;
	readonly readOnly?: Expression;
	readonly presentation?: NodePresentation;
}

export interface GroupNode extends BaseNode {
	readonly type: "group";
	readonly label?: string;
	readonly children: readonly FormNode[];
}

export interface SectionNode extends BaseNode {
	readonly type: "section";
	readonly title?: string;
	readonly description?: string;
	readonly children: readonly FormNode[];
}

export interface FieldNode extends BaseNode {
	readonly type: "field";
	readonly submitWhenHidden?: "include";
	readonly binding: Binding;
	readonly widget: string;
	readonly label?: string;
	readonly required?: Expression;
	readonly props?: ExtensionProps;
}

export interface RepeaterNode extends BaseNode {
	readonly type: "repeater";
	readonly binding: Binding;
	readonly scope: string;
	readonly label?: string;
	readonly children: readonly FormNode[];
	readonly minItems?: number;
	readonly maxItems?: number;
}

export type ActionConcurrency = "drop" | "replace" | "queue";

export interface ActionNode extends BaseNode {
	readonly type: "action";
	readonly action: string;
	readonly label?: string;
	readonly payload?: Expression;
	readonly concurrency?: ActionConcurrency;
	readonly target?: Binding;
	readonly props?: ExtensionProps;
}

export type OutputFormat = "plain" | "number" | "currency-usd" | "percent";

export interface OutputNode extends BaseNode {
	readonly type: "output";
	readonly value: Expression;
	readonly label?: string;
	readonly format?: OutputFormat;
	readonly props?: ExtensionProps;
}

export interface ConditionalNode extends BaseNode {
	readonly type: "conditional";
	readonly condition: Expression;
	readonly then: readonly FormNode[];
	readonly else?: readonly FormNode[];
}

export interface Tab {
	readonly id: string;
	readonly label: string;
	readonly children: readonly FormNode[];
}

export interface TabsNode extends BaseNode {
	readonly type: "tabs";
	readonly tabs: readonly Tab[];
}

export interface AccordionItem {
	readonly id: string;
	readonly label: string;
	readonly children: readonly FormNode[];
}

export interface AccordionNode extends BaseNode {
	readonly type: "accordion";
	readonly items: readonly AccordionItem[];
}

export interface ValidationNode extends BaseNode {
	readonly type: "validation";
	readonly binding: Binding;
	readonly messages?: readonly string[];
}

export interface CustomNode extends BaseNode {
	readonly type: "custom";
	readonly renderer: string;
	readonly props?: ExtensionProps;
	readonly children?: readonly FormNode[];
}

export type FormNode =
	| GroupNode
	| SectionNode
	| FieldNode
	| RepeaterNode
	| ActionNode
	| OutputNode
	| ConditionalNode
	| TabsNode
	| AccordionNode
	| ValidationNode
	| CustomNode;
