import { createArbiterPlugin } from "@formbar/arbiter";
import type { FormState } from "@formbar/core";
import type { FormbarOption, LayoutNode, SchemaFieldInfo, SchemaFormResult } from "@formbar/from-schema";
import { createFormPresentation, isSectionNode } from "@formbar/from-schema";
import { type ResolvedFieldState, useSchemaForm } from "@formbar/react-schema";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui";
import { ArrayRenderer } from "./ArrayRenderer";
import { DemoFormField } from "./DemoFormField";
import type { DemoFormApi } from "./demo-form-api";

const COLUMN_CLASSES: Record<number, string> = {
	1: "grid grid-cols-1 gap-4",
	2: "grid grid-cols-1 sm:grid-cols-2 gap-4",
	3: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
};

/** Extract items schemas for array fields from the raw JSON Schema */
function buildArrayItemsMap(rawSchema: object): ReadonlyMap<string, Record<string, unknown>> {
	const map = new Map<string, Record<string, unknown>>();
	const props = (rawSchema as Record<string, unknown>).properties as
		| Record<string, Record<string, unknown>>
		| undefined;
	if (!props) return map;
	for (const [key, fieldSchema] of Object.entries(props)) {
		if (fieldSchema.type === "array" && fieldSchema.items && typeof fieldSchema.items === "object") {
			map.set(key, fieldSchema.items as Record<string, unknown>);
		}
	}
	return map;
}

const EMPTY_RULES: readonly unknown[] = [];
const EMPTY_UI_STATE: Readonly<Record<string, unknown>> = {};

export interface DemoFormSnapshot {
	readonly state: FormState<Record<string, unknown>, Record<string, unknown>>;
	readonly metadata: unknown;
	readonly warnings: readonly unknown[];
}

interface DemoFormRootProps {
	readonly schema: object;
	readonly data: Record<string, unknown>;
	readonly layout?: object;
	readonly onChange: (path: string, value: unknown) => void;
	readonly responsive?: boolean;
	readonly rules?: readonly unknown[];
	readonly initialUiState?: Record<string, unknown>;
	readonly onSnapshot?: (snapshot: DemoFormSnapshot) => void;
}

export function DemoFormRoot(props: DemoFormRootProps) {
	const { schema, data, layout: layoutOverride, rules = EMPTY_RULES, initialUiState = EMPTY_UI_STATE } = props;
	const plugins = useMemo(
		() =>
			rules.length
				? [createArbiterPlugin({ rules: rules as NonNullable<Parameters<typeof createArbiterPlugin>[0]["rules"]> })]
				: [],
		[rules],
	);
	const result = useSchemaForm<Record<string, unknown>, Record<string, unknown>>(schema, {
		initialData: data,
		initialUiState,
		...(layoutOverride ? { layoutOverride: layoutOverride as LayoutNode } : {}),
		plugins,
	});
	const prepared = useMemo<SchemaFormResult>(
		() => ({
			fields: result.fields,
			layout: result.layout,
			metadata: result.metadata,
			validators: [],
			defaults: {},
			optionsByPath: result.optionsByPath,
			warnings: result.warnings,
		}),
		[result.fields, result.layout, result.metadata, result.optionsByPath, result.warnings],
	);
	return (
		<DemoFormView
			form={result.form}
			schema={prepared}
			rawSchema={schema}
			onChange={props.onChange}
			onSnapshot={props.onSnapshot}
		/>
	);
}

export interface DemoFormViewProps {
	readonly form: DemoFormApi;
	readonly schema: SchemaFormResult;
	readonly rawSchema?: object;
	readonly onChange?: (path: string, value: unknown) => void;
	readonly onSnapshot?: (snapshot: DemoFormSnapshot) => void;
}

/** A renderer-only demo view. The caller retains form creation and disposal ownership. */
export function DemoFormView({ form, schema, rawSchema, onChange = () => undefined, onSnapshot }: DemoFormViewProps) {
	const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
	const presentation = useMemo(
		() =>
			createFormPresentation(schema, {
				uiState: (state.uiState ?? {}) as Readonly<Record<string, unknown>>,
				issues: state.issues,
			}),
		[schema, state],
	);
	const fields = schema.fields;
	const layout = presentation.layout ?? { ...schema.layout, children: [] };
	const fieldStates = useMemo(
		() => new Map(presentation.fields.map((field) => [field.path, field.state])),
		[presentation],
	);
	const fieldMap = useMemo(() => indexFields(fields), [fields]);
	const arrayItemsMap = useMemo(() => buildArrayItemsMap(rawSchema ?? {}), [rawSchema]);
	const handleChange = useCallback(
		(path: string, value: unknown) => {
			onChange(path, value);
		},
		[onChange],
	);
	useEffect(
		() => onSnapshot?.({ state, metadata: schema.metadata, warnings: schema.warnings }),
		[onSnapshot, schema.metadata, schema.warnings, state],
	);
	const renderContext = {
		form,
		fieldMap,
		optionsByPath: schema.optionsByPath,
		fieldStates,
		onChange: handleChange,
		arrayItemsMap,
	};
	return <DemoFormCards formData={state.data} renderContext={renderContext} layout={layout} />;
}

function indexFields(fields: readonly SchemaFieldInfo[]): Map<string, SchemaFieldInfo> {
	return new Map(fields.map((field) => [field.path, field]));
}

interface DemoFormCardsProps {
	readonly formData: Record<string, unknown>;
	readonly renderContext: DemoRenderContext;
	readonly layout: LayoutNode;
}

function DemoFormCards({ formData, renderContext, layout }: DemoFormCardsProps) {
	return (
		<>
			<Card className="border-border">
				<CardHeader>
					<CardTitle className="text-foreground">Live Form</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col gap-4">{renderNode(layout, renderContext)}</div>
				</CardContent>
			</Card>
			<Card className="border-border mt-4">
				<CardHeader className="pb-2">
					<CardTitle className="text-sm text-foreground">Form Data (JSON)</CardTitle>
				</CardHeader>
				<CardContent>
					<pre className="rounded-md bg-surface-inset p-3 text-xs text-code-foreground overflow-auto max-h-48 border border-border-muted font-mono">
						{JSON.stringify(formData, null, 2)}
					</pre>
				</CardContent>
			</Card>
		</>
	);
}

interface DemoRenderContext {
	readonly form: DemoFormApi;
	readonly fieldMap: Map<string, SchemaFieldInfo>;
	readonly optionsByPath: ReadonlyMap<string, readonly FormbarOption[]>;
	readonly fieldStates: ReadonlyMap<string, ResolvedFieldState>;
	readonly onChange: (path: string, value: unknown) => void;
	readonly arrayItemsMap: ReadonlyMap<string, Record<string, unknown>>;
}

function renderNode(node: LayoutNode, context: DemoRenderContext): React.ReactNode {
	if (node.type === "field" && node.path) {
		return renderFieldNode(node, context);
	}

	if (isSectionNode(node)) {
		const columns = (node.props?.columns as number) ?? 1;
		const title = node.props?.title;
		const gridClass = COLUMN_CLASSES[columns] ?? "flex flex-col gap-4";
		return (
			<div key={node.id} className="flex flex-col gap-3">
				{title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
				<div className={gridClass}>{node.children?.map((child) => renderNode(child, context))}</div>
			</div>
		);
	}

	if (node.type === "array" && node.path) {
		return (
			<ArrayRenderer
				key={node.id}
				node={node}
				form={context.form}
				fieldMap={context.fieldMap}
				optionsByPath={context.optionsByPath}
				fieldStates={context.fieldStates}
				onChange={context.onChange}
				itemSchema={context.arrayItemsMap.get(node.path)}
			/>
		);
	}

	return (
		<div key={node.id} className="flex flex-col gap-4">
			{node.children?.map((child) => renderNode(child, context))}
		</div>
	);
}

function renderFieldNode(node: LayoutNode, context: DemoRenderContext): React.ReactNode {
	const field = node.path ? context.fieldMap.get(node.path) : undefined;
	if (!field) return null;
	return (
		<DemoFormField
			key={node.id}
			form={context.form}
			field={field}
			options={context.optionsByPath.get(field.path)}
			fieldState={context.fieldStates.get(field.path)}
			onChange={context.onChange}
		/>
	);
}
