import { structuredEqual } from "@formbar/core";
import type { FormState, ValidationIssue } from "@formbar/core";
import type { FieldNode, FormNode, ResolvedFieldState } from "@formbar/declarative";
import type { DescriptorDocument } from "@formbar/from-schema";
import { fieldId, useFormSelector } from "@formbar/react";
import { useEffect, useId, useMemo, useRef } from "react";
import type { FormEvent, ReactElement } from "react";
import { FormNodeView } from "./form-node.js";
import { domIdToken, focusableField } from "./renderer-evidence.js";
import type { RendererEnvironment } from "./renderer-types.js";
import { useOwnedRuntime } from "./use-runtime-observation.js";
import type { UseSchemaFormResult } from "./use-schema-form.js";

export type FormRendererProps<TData = unknown, TUi = unknown> = Pick<
	UseSchemaFormResult<TData, TUi>,
	"form" | "descriptors" | "definition" | "baseline"
>;

export function FormRenderer<TData, TUi>(props: FormRendererProps<TData, TUi>): ReactElement {
	const runtime = useOwnedRuntime({ form: props.form, definition: props.definition, baseline: props.baseline });
	const rootId = useId();
	const prefix = useMemo(
		() => fieldId(domIdToken(props.definition.id), `formbar-${domIdToken(rootId)}`),
		[props.definition.id, rootId],
	);
	const root = useFormSelector(props.form, selectRootState, structuredEqual);
	const fieldNodes = useMemo(() => renderedFieldNodes(props.definition.root), [props.definition.root]);
	const environment = useMemo<RendererEnvironment>(
		() => ({
			runtime,
			form: props.form as RendererEnvironment["form"],
			descriptors: props.descriptors,
			prefix,
			submitted: root.submitted,
		}),
		[runtime, props.form, props.descriptors, prefix, root.submitted],
	);
	const summary = summaryEntries(runtime.getSnapshot().fields, root.issues, prefix, fieldNodes, props.descriptors);
	const summaryId = `${prefix}-error-summary`;
	const hasErrors = root.issues.some(errorIssue);
	useFailedSubmitFocus(root.status, root.submitId, summary.find((entry) => entry.target)?.target, summaryId);
	return (
		<form
			noValidate
			aria-busy={root.status === "running" || root.validating || undefined}
			data-formbar-definition={props.definition.id}
			onSubmit={(event) => submit(event, props.form)}
		>
			<div aria-live="polite" data-formbar-status="">
				{statusText(root.status, root.validating, hasErrors)}
			</div>
			{root.submitted && hasErrors ? <ErrorSummary id={summaryId} entries={summary} /> : null}
			<FormNodeView node={props.definition.root} environment={environment} />
		</form>
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
): readonly SummaryEntry[] {
	return issues.filter(errorIssue).map((issue) => {
		const field = fields.find((candidate) => {
			const node = nodes.get(candidate.instance.nodeId);
			return Boolean(node && samePath(candidate, issue) && focusableField(node, candidate, descriptors));
		});
		return {
			...(field ? { target: fieldId(domIdToken(field.instance.nodeId), prefix) } : {}),
			message: issue.message,
		};
	});
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
		else if (node.type === "group" || node.type === "section") for (const child of node.children) visit(child);
		else if (node.type === "conditional") {
			for (const child of node.then) visit(child);
			for (const child of node.else ?? []) visit(child);
		}
	};
	visit(root);
	return fields;
}
