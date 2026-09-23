import type { RendererContext } from "@formbar/react-schema";
import type { CSSProperties } from "react";
import type { SchemaDemoRuntimeProfile } from "../demos/baseline-contracts";

export function InspectionPanel({ children, props, policy }: RendererContext) {
	const title = typeof props.title === "string" ? props.title : "Vessel Inspection";
	return (
		<section
			className="rounded-lg border border-border p-4"
			data-extension-node="inspection-panel"
			data-disabled={policy.disabled || undefined}
			data-readonly={policy.readOnly || undefined}
		>
			<h2 className="mb-4 text-lg font-semibold">{title}</h2>
			<div className="grid gap-4">{children}</div>
		</section>
	);
}

export function FieldGrid({ children, props, policy }: RendererContext) {
	const columns = typeof props.columns === "number" && props.columns >= 1 ? Math.min(props.columns, 4) : 2;
	const style = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } satisfies CSSProperties;
	return (
		<div
			className="grid gap-4"
			style={style}
			data-extension-node="field-grid"
			data-disabled={policy.disabled || undefined}
			data-readonly={policy.readOnly || undefined}
		>
			{children}
		</div>
	);
}

const nodes = Object.freeze([
	Object.freeze({ id: "demo17.inspection-panel", component: InspectionPanel }),
	Object.freeze({ id: "demo17.field-grid", component: FieldGrid }),
]);

export const customLayoutProfile: SchemaDemoRuntimeProfile = Object.freeze({
	id: "demo17.advanced-layout.v1",
	extensions: Object.freeze({ nodes }),
});
