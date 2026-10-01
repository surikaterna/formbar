import type { KaladaV1Control, KaladaV1Host } from "@formbar/declarative";
import { type ComponentType, type ReactNode, useEffect, useRef } from "react";
import { CommitLease, useKaladaFormContext } from "./kalada-commit-lease.js";
import { KaladaExtensionBoundary } from "./kalada-extension-boundary.js";
import { extensionRecovery } from "./kalada-extension-recovery.js";
import type { KaladaControlProps } from "./kalada-form-renderer.js";
import { kaladaLayoutProps409 } from "./kalada-layout-409.js";

function accessibility(
	control: KaladaV1Control,
	label: string | undefined,
	children: ReactNode,
	prefix: string,
	feedbackIds?: readonly string[],
) {
	const id = `${prefix}-${encodeURIComponent(control.key)}`;
	const messages = [...(control.lifecycle?.issues.schema ?? []), ...(control.lifecycle?.issues.extension ?? [])];
	const description = typeof control.props.description === "string" ? control.props.description : undefined;
	return {
		nodeId: control.nodeId,
		value: control.value,
		props: control.props,
		writers: control.writers,
		disabled: control.disabled,
		readOnly: control.readOnly,
		required: control.required ?? control.props.required === true,
		label: label ?? (typeof control.props.label === "string" ? control.props.label : control.nodeId),
		description,
		dirty: control.lifecycle?.dirty ?? false,
		touched: control.lifecycle?.touched ?? false,
		validating: control.lifecycle?.validating ?? false,
		valid: control.lifecycle?.valid ?? true,
		onBlur: control.onBlur,
		...(control.type === "custom" ? { children } : {}),
		a11y: {
			controlId: id,
			labelId: `${id}-label`,
			descriptionId: description ? `${id}-description` : undefined,
			issueId: messages.length ? `${id}-issues` : undefined,
			describedBy:
				[
					description ? `${id}-description` : undefined,
					messages.length ? `${id}-issues` : undefined,
					...(feedbackIds ?? []),
				]
					.filter(Boolean)
					.join(" ") || undefined,
			invalid: messages.length > 0 || control.lifecycle?.valid === false,
		},
		messages,
	};
}

export function KaladaCustomControl({
	control,
	component,
	label,
	children,
	host,
	feedbackIds,
}: {
	control: KaladaV1Control;
	component: ComponentType<KaladaControlProps>;
	label?: string;
	children?: ReactNode;
	host: KaladaV1Host;
	feedbackIds?: readonly string[] | undefined;
}) {
	const { prefix, leases } = useKaladaFormContext();
	const previous = useRef<CommitLease | undefined>(undefined);
	previous.current?.revoke();
	const lease = new CommitLease();
	previous.current = lease;
	useEffect(() => {
		const unregister = leases.register(lease);
		return unregister;
	}, [lease, leases]);
	const props = { ...accessibility(control, label, children, prefix, feedbackIds), ...lease.channels(control) };
	const layout = kaladaLayoutProps409(control.presentation);
	return (
		<div data-kalada-control={control.nodeId} {...layout.attributes} style={layout.style}>
			<label id={props.a11y.labelId} htmlFor={props.a11y.controlId}>
				{props.label}
			</label>
			{props.description ? <span id={props.a11y.descriptionId}>{props.description}</span> : null}
			<KaladaExtensionBoundary
				component={component}
				control={props}
				lease={lease}
				owner={host}
				recovery={extensionRecovery(control, host, label)}
			/>
			{props.a11y.issueId ? <span id={props.a11y.issueId}>{props.messages.join(" ")}</span> : null}
		</div>
	);
}
