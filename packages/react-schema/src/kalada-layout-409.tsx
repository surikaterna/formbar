import type { CSSProperties, ReactElement, ReactNode } from "react";
import { formatKaladaOutput409 } from "./kalada-output-formatters-409.js";
import type { KaladaOutputFormat409 } from "./kalada-output-formatters-409.js";

export type KaladaSpan409 = number | "auto" | "full";
export interface KaladaLayout409 {
	readonly span?: KaladaSpan409 | Partial<Record<"base" | "sm" | "md" | "lg" | "xl", KaladaSpan409>>;
}

export function kaladaLayoutProps409(presentation?: KaladaLayout409): {
	readonly attributes: Readonly<Record<string, string>>;
	readonly style?: CSSProperties;
} {
	if (presentation?.span === undefined) return { attributes: {} };
	const values = typeof presentation.span === "object" ? presentation.span : { base: presentation.span };
	const attributes: Record<string, string> = {};
	const style: Record<string, string> = {};
	for (const breakpoint of ["base", "sm", "md", "lg", "xl"] as const) {
		const raw = values[breakpoint];
		if (raw === undefined) continue;
		const value = raw === "full" ? "12" : String(raw);
		attributes[`data-formbar-span-${breakpoint}`] = value;
		style[`--formbar-span-${breakpoint}`] = value;
	}
	return { attributes, style: style as CSSProperties };
}

/** Deterministic instance identity; caller supplies a stable host row token, not an array index. */
export function kaladaDomId409(prefix: string, instanceKey: string, suffix: string): string {
	let token = "u";
	for (let index = 0; index < instanceKey.length; index++)
		token += instanceKey.charCodeAt(index).toString(16).padStart(4, "0");
	return `${prefix}-${token}-${suffix}`;
}

interface Container409 {
	readonly nodeId: string;
	readonly instanceKey: string;
	readonly prefix: string;
	readonly presentation?: KaladaLayout409;
	readonly children?: ReactNode;
}

export function KaladaGroup409(props: Container409 & { readonly label?: string }): ReactElement {
	const layout = kaladaLayoutProps409(props.presentation);
	const id = props.label ? kaladaDomId409(props.prefix, props.instanceKey, "legend") : undefined;
	return (
		<fieldset data-formbar-node={props.nodeId} aria-labelledby={id} {...layout.attributes} style={layout.style}>
			{props.label ? <legend id={id}>{props.label}</legend> : null}
			{props.children}
		</fieldset>
	);
}

export function KaladaSection409(
	props: Container409 & { readonly title?: string; readonly description?: string },
): ReactElement {
	const layout = kaladaLayoutProps409(props.presentation);
	const heading = props.title ? kaladaDomId409(props.prefix, props.instanceKey, "heading") : undefined;
	const description = props.description ? kaladaDomId409(props.prefix, props.instanceKey, "description") : undefined;
	return (
		<section
			data-formbar-node={props.nodeId}
			aria-labelledby={heading}
			aria-describedby={description}
			{...layout.attributes}
			style={layout.style}
		>
			{props.title ? <h2 id={heading}>{props.title}</h2> : null}
			{props.description ? <p id={description}>{props.description}</p> : null}
			{props.children}
		</section>
	);
}

export function KaladaOutput409(
	props: Omit<Container409, "children"> & {
		readonly label?: string;
		readonly value: unknown;
		readonly format?: KaladaOutputFormat409;
	},
): ReactElement {
	const layout = kaladaLayoutProps409(props.presentation);
	const result = formatKaladaOutput409(props.value, props.format);
	if (!result.ok)
		return (
			// biome-ignore lint/a11y/useSemanticElements: Public V1 diagnostic contract uses an explicit status role.
			<div
				role="status"
				data-formbar-diagnostic={result.diagnostic}
				data-formbar-node={props.nodeId}
				{...layout.attributes}
				style={layout.style}
			>
				Calculated value is unavailable.
			</div>
		);
	const id = kaladaDomId409(props.prefix, props.instanceKey, "label");
	return (
		<div data-formbar-node={props.nodeId} {...layout.attributes} style={layout.style}>
			<span id={id}>{props.label?.trim() ? props.label : "Calculated value"}</span>
			<output aria-labelledby={id}>{result.text}</output>
		</div>
	);
}
