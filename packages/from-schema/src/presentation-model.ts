import type { ValidationIssue } from "@formbar/core";
import type { SchemaFieldInfo, SchemaFieldMetadata, SchemaMetadata } from "@scheman/core";
import type { FormbarOption } from "./formbar-options.js";
import type { LayoutNode } from "./layout/layout-types.js";

export interface ResolvedFieldState {
	readonly visible: boolean;
	readonly readOnly: boolean;
	readonly disabled: boolean;
}

export interface FieldStateDefinition {
	readonly path: string;
	readonly readOnly?: boolean;
}

export interface PresentationFieldIds {
	readonly field: string;
	readonly description: string;
	readonly error: string;
}

export interface PresentationField {
	readonly path: string;
	readonly type: SchemaFieldInfo["type"];
	readonly title: string;
	readonly description: string | undefined;
	readonly required: boolean;
	readonly metadata: SchemaFieldMetadata | undefined;
	readonly options: readonly FormbarOption[];
	readonly issues: readonly ValidationIssue[];
	readonly state: ResolvedFieldState;
	readonly ids: PresentationFieldIds;
}

export interface FormPresentation {
	readonly layout: LayoutNode | null;
	readonly fields: readonly PresentationField[];
	readonly fieldsByPath: ReadonlyMap<string, PresentationField>;
	readonly formIssues: readonly ValidationIssue[];
	readonly metadata: SchemaMetadata;
}

export interface FormPresentationSource {
	readonly fields: readonly SchemaFieldInfo[];
	readonly layout: LayoutNode;
	readonly metadata: SchemaMetadata;
	readonly optionsByPath?: ReadonlyMap<string, readonly FormbarOption[]>;
}

export interface FormPresentationStateInput {
	readonly uiState?: Readonly<Record<string, unknown>>;
	readonly issues?: readonly ValidationIssue[];
}

export const DEFAULT_FIELD_STATE: ResolvedFieldState = Object.freeze({
	visible: true,
	readOnly: false,
	disabled: false,
});

const EMPTY_OPTIONS: readonly FormbarOption[] = Object.freeze([]);
const EMPTY_ISSUES: readonly ValidationIssue[] = Object.freeze([]);

export function resolveFieldStates(
	uiState: Readonly<Record<string, unknown>>,
	fields: readonly (string | FieldStateDefinition)[],
): ReadonlyMap<string, ResolvedFieldState> {
	const result = new Map<string, ResolvedFieldState>();
	for (const field of fields) {
		const definition = typeof field === "string" ? { path: field } : field;
		result.set(definition.path, resolveFieldState(uiState, definition));
	}
	return result;
}

function resolveFieldState(
	uiState: Readonly<Record<string, unknown>>,
	field: FieldStateDefinition,
): ResolvedFieldState {
	const visible = uiState[`${field.path}.visible`];
	const readOnly = uiState[`${field.path}.readOnly`];
	const disabled = uiState[`${field.path}.disabled`];
	if (visible === undefined && readOnly === undefined && disabled === undefined && field.readOnly === undefined) {
		return DEFAULT_FIELD_STATE;
	}
	return {
		visible: visible === undefined ? true : Boolean(visible),
		readOnly: readOnly === undefined ? Boolean(field.readOnly) : Boolean(readOnly),
		disabled: disabled === undefined ? false : Boolean(disabled),
	};
}

export function pruneHiddenFields(
	node: LayoutNode,
	fieldStates: ReadonlyMap<string, ResolvedFieldState>,
): LayoutNode | null {
	if (node.type === "field" && node.path) {
		return (fieldStates.get(node.path) ?? DEFAULT_FIELD_STATE).visible ? node : null;
	}
	if (!node.children) return node;
	const children = node.children.flatMap((child) => {
		const visibleChild = pruneHiddenFields(child, fieldStates);
		return visibleChild === null ? [] : [visibleChild];
	});
	return { ...node, children };
}

export function fieldId(path: string, prefix = "field"): string {
	return `${prefix}-${path
		.replace(/[.[\]/]/g, "-")
		.replace(/-+/g, "-")
		.replace(/-$/, "")}`;
}

export function descriptionId(path: string, prefix?: string): string {
	return `${fieldId(path, prefix)}-description`;
}

export function errorId(path: string, prefix?: string): string {
	return `${fieldId(path, prefix)}-error`;
}

export function createFormPresentation(
	source: FormPresentationSource,
	state: FormPresentationStateInput = {},
): FormPresentation {
	assertValidSource(source);
	const fieldStates = resolveFieldStates(
		state.uiState ?? {},
		source.fields.map((field) => ({
			path: field.path,
			...(field.metadata?.readOnly === undefined ? {} : { readOnly: field.metadata.readOnly }),
		})),
	);
	const issuesByPath = groupIssuesByPath(state.issues ?? EMPTY_ISSUES);
	const fields = source.fields.map((field) => createPresentationField(field, source, fieldStates, issuesByPath));
	const fieldsByPath = new Map(fields.map((field) => [field.path, field]));
	return {
		layout: pruneHiddenFields(source.layout, fieldStates),
		fields,
		fieldsByPath,
		formIssues: getFormIssues(state.issues ?? EMPTY_ISSUES, fieldsByPath),
		metadata: source.metadata,
	};
}

function assertValidSource(source: FormPresentationSource): void {
	const fieldPaths = new Set<string>();
	for (const field of source.fields) {
		if (fieldPaths.has(field.path)) {
			throw new TypeError(`Duplicate schema field path: ${JSON.stringify(field.path)}.`);
		}
		fieldPaths.add(field.path);
	}
	assertLayoutFieldPaths(source.layout, fieldPaths);
}

function assertLayoutFieldPaths(node: LayoutNode, fieldPaths: ReadonlySet<string>): void {
	if (node.type === "field") {
		if (typeof node.path !== "string" || node.path.trim().length === 0) {
			throw new TypeError("Layout field path must be a non-blank string.");
		}
		if (!fieldPaths.has(node.path)) {
			throw new TypeError(`Layout field path is not present in schema fields: ${JSON.stringify(node.path)}.`);
		}
	}
	for (const child of node.children ?? []) {
		assertLayoutFieldPaths(child, fieldPaths);
	}
}

function createPresentationField(
	field: SchemaFieldInfo,
	source: FormPresentationSource,
	states: ReadonlyMap<string, ResolvedFieldState>,
	issuesByPath: ReadonlyMap<string, readonly ValidationIssue[]>,
): PresentationField {
	return {
		path: field.path,
		type: field.type,
		title: field.metadata?.label ?? field.metadata?.title ?? getPathTitle(field.path),
		description: field.metadata?.description,
		required: field.required,
		metadata: field.metadata,
		options: source.optionsByPath?.get(field.path) ?? EMPTY_OPTIONS,
		issues: issuesByPath.get(field.path) ?? EMPTY_ISSUES,
		state: states.get(field.path) ?? DEFAULT_FIELD_STATE,
		ids: {
			field: fieldId(field.path),
			description: descriptionId(field.path),
			error: errorId(field.path),
		},
	};
}

function groupIssuesByPath(issues: readonly ValidationIssue[]): ReadonlyMap<string, readonly ValidationIssue[]> {
	const grouped = new Map<string, ValidationIssue[]>();
	for (const issue of issues) {
		const path = issue.path.segments.join(".");
		grouped.set(path, [...(grouped.get(path) ?? []), issue]);
	}
	return grouped;
}

function getFormIssues(
	issues: readonly ValidationIssue[],
	fieldsByPath: ReadonlyMap<string, PresentationField>,
): readonly ValidationIssue[] {
	return issues.filter((issue) => !fieldsByPath.has(issue.path.segments.join(".")));
}

function getPathTitle(path: string): string {
	return path.split(".").at(-1) ?? path;
}
