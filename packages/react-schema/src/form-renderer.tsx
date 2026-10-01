import type { ReactElement } from "react";
import { KaladaFormRenderer, type KaladaFormRendererProps } from "./kalada-form-renderer.js";

/** Public renderer accepts only an installed Kalada V1 host. Legacy FormApi props fail closed. */
export type FormRendererProps = KaladaFormRendererProps;

export function FormRenderer(props: FormRendererProps): ReactElement {
	if (!props?.host || typeof props.host.snapshot !== "function" || typeof props.host.subscribe !== "function")
		throw new TypeError("root: MISSING_STRATEGY");
	return <KaladaFormRenderer {...props} />;
}
