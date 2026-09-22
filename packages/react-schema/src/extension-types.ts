import type { ValidationIssue } from "@formbar/core";
import type { JsonValue } from "@formbar/declarative";
import type { DescriptorPrimitive } from "@formbar/from-schema";
import type { ComponentType, ReactNode } from "react";

export type ExtensionProps = Readonly<Record<string, JsonValue>>;

export type ExtensionPolicy = Readonly<{
	visible: true;
	disabled: boolean;
	readOnly: boolean;
	required: boolean;
}>;

export interface WidgetBinding {
	readonly namespace: "data" | "ui";
	readonly segments: readonly (string | number)[];
	readonly path: string;
}

export interface WidgetConstraints {
	readonly primitive?: DescriptorPrimitive;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly exclusiveMinimum?: number;
	readonly exclusiveMaximum?: number;
	readonly multipleOf?: number;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly pattern?: string;
	readonly format?: string;
}

export interface WidgetOption {
	readonly value: string | number | boolean | null;
	readonly label: string;
}

export interface WidgetMetadata {
	readonly label: string;
	readonly description?: string;
	readonly defaultValue?: JsonValue;
}

export interface WidgetA11y {
	readonly controlId: string;
	readonly labelId: string;
	readonly descriptionId?: string;
	readonly errorId: string;
	readonly describedBy?: string;
	readonly invalid: boolean;
	readonly required: boolean;
	readonly busy: boolean;
}

export interface WidgetProps {
	readonly nodeId: string;
	readonly instanceKey: string;
	readonly widget: string;
	readonly binding: WidgetBinding;
	readonly value: JsonValue | undefined;
	readonly props: ExtensionProps;
	readonly constraints: WidgetConstraints;
	readonly options: readonly WidgetOption[];
	readonly metadata: WidgetMetadata;
	readonly policy: ExtensionPolicy;
	readonly issues: readonly ValidationIssue[];
	readonly valid: boolean;
	readonly validating: boolean;
	readonly touched: boolean;
	readonly dirty: boolean;
	readonly a11y: WidgetA11y;
	readonly onChange: (value: JsonValue | undefined) => void;
	readonly onBlur: () => void;
}

export interface RendererContext {
	readonly nodeId: string;
	readonly instanceKey: string;
	readonly renderer: string;
	readonly props: ExtensionProps;
	readonly policy: Omit<ExtensionPolicy, "required">;
	readonly children: ReactNode;
}

export interface WidgetRegistration {
	readonly id: string;
	readonly component: ComponentType<WidgetProps>;
	readonly validateProps?: (props: ExtensionProps) => boolean;
}

export interface CustomNodeRegistration {
	readonly id: string;
	readonly component: ComponentType<RendererContext>;
	readonly validateProps?: (props: ExtensionProps) => boolean;
}

export interface RendererExtensions {
	readonly widgets?: readonly WidgetRegistration[];
	readonly nodes?: readonly CustomNodeRegistration[];
}
