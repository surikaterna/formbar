import type { RendererContext } from "@formbar/react-schema";

export function InspectionPanel({ children, props, policy }: RendererContext) {
	const title = typeof props.title === "string" ? props.title : "Vessel Inspection";
	return (
		<section
			className="min-w-0 w-full rounded-lg border border-border bg-background p-3 sm:p-5"
			data-extension-node="inspection-panel"
			data-disabled={policy.disabled || undefined}
			data-readonly={policy.readOnly || undefined}
		>
			<h2 className="mb-5 border-b border-border pb-3 text-xl font-semibold">{title}</h2>
			<div className="min-w-0 space-y-5">{children}</div>
		</section>
	);
}

export function FieldGrid({ children, props, policy }: RendererContext) {
	const columns = typeof props.columns === "number" && props.columns >= 1 ? Math.min(props.columns, 4) : 2;
	return (
		<div
			className="demo17-field-grid"
			data-columns={columns}
			data-extension-node="field-grid"
			data-disabled={policy.disabled || undefined}
			data-readonly={policy.readOnly || undefined}
		>
			{children}
		</div>
	);
}

export const customLayoutRegistrations = Object.freeze([
	Object.freeze({ id: "demo17.inspection-panel", component: InspectionPanel }),
	Object.freeze({ id: "demo17.field-grid", component: FieldGrid }),
]);
