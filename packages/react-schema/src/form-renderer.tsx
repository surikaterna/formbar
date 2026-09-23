import { structuredEqual } from "@formbar/core";
import type { FormState, ValidationIssue } from "@formbar/core";
import type { ActionRegistration, FieldNode, FormNode, ResolvedFieldState } from "@formbar/declarative";
import type { DescriptorDocument } from "@formbar/from-schema";
import { fieldId, useFormSelector } from "@formbar/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { normalizeExtensions, resolveWidget } from "./extension-registry.js";
import type { RendererExtensions } from "./extension-types.js";
import { FormNodeView } from "./form-node.js";
import { DiagnosticFallback } from "./renderer-elements.js";
import { domIdToken, focusableField } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";
import { RepeaterCoordinator } from "./repeater-coordinator.js";
import { useOwnedActionExecutor } from "./use-action-executor.js";
import { useOwnedRuntime } from "./use-runtime-observation.js";
import type { UseSchemaFormResult } from "./use-schema-form.js";

export interface FormRendererProps<TData = unknown, TUi = unknown>
	extends Pick<UseSchemaFormResult<TData, TUi>, "form" | "descriptors" | "definition" | "baseline"> {
	readonly repeaterBaseline?: UseSchemaFormResult<TData, TUi>["repeaterBaseline"];
	readonly extensions?: RendererExtensions;
	readonly actions?: readonly ActionRegistration[];
}

export function FormRenderer<TData, TUi>(props: FormRendererProps<TData, TUi>): ReactElement {
	const model = useRendererModel(props);
	useFailedSubmitFocus(
		model.root.status,
		model.root.submitId,
		model.summary.find((entry) => entry.target)?.target,
		model.summaryId,
	);
	return (
		<form
			noValidate
			aria-busy={model.root.status === "running" || model.root.validating || undefined}
			data-formbar-definition={props.definition.id}
			onSubmit={(event) => submit(event, props.form)}
		>
			<div aria-live="polite" data-formbar-status="">
				{statusText(model.root.status, model.root.validating, model.hasErrors)}
			</div>
			{model.root.submitted && model.hasErrors ? <ErrorSummary id={model.summaryId} entries={model.summary} /> : null}
			<RegistryDiagnostics extensions={model.environment.extensions} />
			<ActionRegistryDiagnostics executor={model.environment.actions} />
			<FormNodeView node={props.definition.root} environment={model.environment} />
		</form>
	);
}

function useRendererModel<TData, TUi>(props: FormRendererProps<TData, TUi>) {
	const runtime = useOwnedRuntime({
		form: props.form,
		definition: props.definition,
		baseline: props.baseline,
		...(props.repeaterBaseline ? { repeaterBaseline: props.repeaterBaseline } : {}),
	});
	const actionExecutor = useOwnedActionExecutor(props.form as RendererEnvironment["form"], runtime, props.actions);
	const rootId = useId();
	const prefix = useMemo(
		() => fieldId(domIdToken(props.definition.id), `formbar-${domIdToken(rootId)}`),
		[props.definition.id, rootId],
	);
	const root = useFormSelector(props.form, selectRootState, structuredEqual);
	const fieldNodes = useMemo(() => renderedFieldNodes(props.definition.root), [props.definition.root]);
	const extensions = useMemo(() => normalizeExtensions(props.extensions), [props.extensions]);
	const repeaters = useMemo(
		() => createRepeaterCoordinator(props.form, props.definition),
		[props.form, props.definition],
	);
	useEffect(() => props.form.onReset(() => repeaters.reset()), [props.form, repeaters]);
	const failures = useExtensionFailures();
	const { failedExtensions, extensionFailed, extensionRecovered } = failures;
	const environment = useMemo<RendererEnvironment>(
		() => ({
			runtime,
			form: props.form as RendererEnvironment["form"],
			actions: actionExecutor,
			descriptors: props.descriptors,
			prefix,
			submitted: root.submitted,
			extensions,
			repeaters,
			extensionFailed,
			extensionRecovered,
		}),
		[
			runtime,
			props.form,
			actionExecutor,
			props.descriptors,
			prefix,
			root.submitted,
			extensions,
			repeaters,
			extensionFailed,
			extensionRecovered,
		],
	);
	const summary = summaryEntries(
		runtime.getSnapshot().fields,
		root.issues,
		prefix,
		fieldNodes,
		props.descriptors,
		extensions,
		failedExtensions,
	);
	const summaryId = `${prefix}-error-summary`;
	const hasErrors = root.issues.some(errorIssue);
	return { root, environment, summary, summaryId, hasErrors };
}

function createRepeaterCoordinator(form: object, definition: object): RepeaterCoordinator {
	void form;
	void definition;
	return new RepeaterCoordinator();
}

function ActionRegistryDiagnostics(props: { readonly executor: RendererEnvironment["actions"] }): ReactElement {
	return (
		<>
			{props.executor.getDiagnostics().map((diagnostic, index) => (
				<output
					key={`${diagnostic.code}:${diagnostic.action ?? ""}:${index}`}
					data-formbar-action={diagnostic.action ?? ""}
					data-formbar-diagnostic={diagnostic.code}
				>
					Action unavailable.
				</output>
			))}
		</>
	);
}

function useExtensionFailures() {
	const [failedExtensions, setFailedExtensions] = useState<ReadonlySet<string>>(() => new Set());
	const extensionFailed = useCallback((nodeId: string) => {
		setFailedExtensions((current) => (current.has(nodeId) ? current : new Set([...current, nodeId])));
	}, []);
	const extensionRecovered = useCallback((nodeId: string) => {
		setFailedExtensions((current) => {
			if (!current.has(nodeId)) return current;
			const next = new Set(current);
			next.delete(nodeId);
			return next;
		});
	}, []);
	return { failedExtensions, extensionFailed, extensionRecovered };
}

function RegistryDiagnostics(props: { readonly extensions: RendererEnvironment["extensions"] }): ReactElement {
	return (
		<>
			{props.extensions.diagnostics.map((diagnostic) => (
				<DiagnosticFallback
					key={`${diagnostic.code}:${diagnostic.extensionId}`}
					code={diagnostic.code}
					nodeId="renderer"
					extensionId={diagnostic.extensionId}
				/>
			))}
		</>
	);
}

interface RootState {
	readonly issues: readonly ValidationIssue[];
	readonly submitted: boolean;
	readonly validating: boolean;
	readonly status: "idle" | "running" | "succeeded" | "failed";
	readonly submitId?: string;
}

function selectRootState<TData, TUi>(state: FormState<TData, TUi>): RootState {
	return {
		issues: state.issues,
		submitted: state.meta.submitted === true,
		validating: state.meta.validation.validating === true,
		status: state.meta.submission?.status ?? "idle",
		...(state.meta.submission?.submitId ? { submitId: state.meta.submission.submitId } : {}),
	};
}

function submit<TData, TUi>(event: FormEvent<HTMLFormElement>, form: FormRendererProps<TData, TUi>["form"]): void {
	event.preventDefault();
	void form.submit().catch(() => undefined);
}

interface SummaryEntry {
	readonly target?: string;
	readonly message: string;
}

function summaryEntries(
	fields: readonly ResolvedFieldState[],
	issues: readonly ValidationIssue[],
	prefix: string,
	nodes: ReadonlyMap<string, FieldNode>,
	descriptors: DescriptorDocument,
	extensions: ReturnType<typeof normalizeExtensions>,
	failedExtensions: ReadonlySet<string>,
): readonly SummaryEntry[] {
	return issues.filter(errorIssue).map((issue) => {
		const field = fields.find((candidate) => {
			const node = nodes.get(candidate.instance.nodeId);
			return Boolean(
				node &&
					!failedExtensions.has(node.id) &&
					samePath(candidate, issue) &&
					focusable(node, candidate, descriptors, extensions),
			);
		});
		return {
			...(field ? { target: fieldId(domIdToken(field.instance.instanceKey), prefix) } : {}),
			message: issue.message,
		};
	});
}

function focusable(
	node: FieldNode,
	state: ResolvedFieldState,
	descriptors: DescriptorDocument,
	extensions: ReturnType<typeof normalizeExtensions>,
): boolean {
	if (!state.visible || state.disabled) return false;
	if (focusableField(node, state, descriptors)) return true;
	return resolveWidget(extensions, node).ok;
}

function ErrorSummary(props: { readonly id: string; readonly entries: readonly SummaryEntry[] }): ReactElement {
	return (
		<div id={props.id} role="alert" tabIndex={-1} data-formbar-error-summary="">
			<p>There are errors in this form.</p>
			{props.entries.length ? (
				<ul>
					{props.entries.map((entry, index) => (
						<li key={`${entry.target ?? "global"}:${index}`}>
							{entry.target ? <a href={`#${entry.target}`}>{entry.message}</a> : entry.message}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function useFailedSubmitFocus(
	status: RootState["status"],
	submitId: string | undefined,
	target: string | undefined,
	summaryId: string,
): void {
	const focused = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (status !== "failed" || !submitId || focused.current === submitId) return;
		focused.current = submitId;
		const element = (target ? document.getElementById(target) : null) ?? document.getElementById(summaryId);
		element?.focus();
	}, [status, submitId, target, summaryId]);
}

function statusText(status: RootState["status"], validating: boolean, hasErrors: boolean): string {
	if (status === "running") return "Submitting form.";
	if (status === "succeeded") return "Form submitted.";
	if (status === "failed") return hasErrors ? "" : "Form submission failed.";
	return validating ? "Validating form." : "";
}

function errorIssue(issue: ValidationIssue): boolean {
	return issue.severity === "error";
}

function samePath(field: ResolvedFieldState, issue: ValidationIssue): boolean {
	return (
		field.binding.namespace === issue.path.namespace &&
		field.binding.segments.length === issue.path.segments.length &&
		field.binding.segments.every((segment, index) => segment === issue.path.segments[index])
	);
}

function renderedFieldNodes(root: FormNode): ReadonlyMap<string, FieldNode> {
	const fields = new Map<string, FieldNode>();
	const visit = (node: FormNode): void => {
		if (node.type === "field") fields.set(node.id, node);
		else if (node.type === "group" || node.type === "section" || node.type === "repeater")
			for (const child of node.children) visit(child);
		else if (node.type === "tabs") for (const tab of node.tabs) for (const child of tab.children) visit(child);
		else if (node.type === "accordion") for (const item of node.items) for (const child of item.children) visit(child);
		else if (node.type === "custom") for (const child of node.children ?? []) visit(child);
		else if (node.type === "conditional") {
			for (const child of node.then) visit(child);
			for (const child of node.else ?? []) visit(child);
		}
	};
	visit(root);
	return fields;
}
