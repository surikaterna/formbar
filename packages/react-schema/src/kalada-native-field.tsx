import type { KaladaV1Control } from "@formbar/declarative";
import { kaladaLayoutProps409 } from "./kalada-layout-409.js";
import { nativeControl } from "./kalada-native-controls.js";

/** Native description and issue association stay separate from browser validity and host authorization. */
export function KaladaNativeField({
	control,
	prefix,
	label,
	focusRef,
	feedbackIds,
}: {
	control: KaladaV1Control;
	prefix: string;
	label?: string;
	focusRef?: (element: HTMLElement | null) => void;
	feedbackIds?: readonly string[] | undefined;
}) {
	const id = `${prefix}-${encodeURIComponent(control.key)}`;
	const layout = kaladaLayoutProps409(control.presentation);
	const messages = [...(control.lifecycle?.issues.schema ?? []), ...(control.lifecycle?.issues.extension ?? [])];
	const description = typeof control.props.description === "string" ? control.props.description : undefined;
	const issueId = messages.length ? `${id}-issues` : undefined;
	const describedBy =
		[description ? `${id}-description` : undefined, issueId, ...(feedbackIds ?? [])].filter(Boolean).join(" ") ||
		undefined;
	return (
		<div data-kalada-control={control.nodeId} {...layout.attributes} style={layout.style}>
			{control.rendererId === "radio" ? (
				<span id={`${id}-label`}>{label ?? control.nodeId}</span>
			) : (
				<label htmlFor={id}>{label ?? control.nodeId}</label>
			)}
			{description ? <span id={`${id}-description`}>{description}</span> : null}
			{nativeControl(control, describedBy, prefix, focusRef)}
			{issueId ? <span id={issueId}>{messages.join(" ")}</span> : null}
		</div>
	);
}
