import { createArbiterPlugin } from "@formbar/arbiter";
import { type FormPlugin, type FormState, type SubmitExecutionContext, structuredEqual } from "@formbar/core";
import { jsonSchemaProvider } from "@formbar/from-schema";
import { useFormSelector } from "@formbar/react";
import { FormRenderer, type UseSchemaFormResult, useSchemaForm } from "@formbar/react-schema";
import { useEffect, useId, useMemo, useState } from "react";
import type { TrustedRuntimeProfileId } from "../demos/baseline-contracts";
import type { PlaygroundDocument, PlaygroundExample } from "../playground/contracts";
import { resolveTrustedRuntimeProfiles } from "../runtime/trusted-runtime-profiles";

const provider = jsonSchemaProvider({ dialect: "draft-2020-12" });
const noPlugins: readonly FormPlugin<Record<string, unknown>, Record<string, unknown>>[] = [];

export interface SchemaFormRuntimeProps {
	readonly document: PlaygroundDocument;
	readonly profileIds?: readonly TrustedRuntimeProfileId[];
	readonly initialUiState?: Readonly<Record<string, unknown>>;
	readonly arbiterRules?: PlaygroundExample["runtime"]["arbiterRules"];
	readonly actionControls?: "host" | "definition";
	readonly onSubmit?: (payload: Readonly<Record<string, unknown>>) => void;
	readonly showObservability?: boolean;
}

export function SchemaFormRuntime(props: SchemaFormRuntimeProps) {
	const profiles = useMemo(
		() => resolveTrustedRuntimeProfiles(props.profileIds ?? ["formbar.standard.v1"]),
		[props.profileIds],
	);
	const committed = useCommittedArbiterPlugin(props.arbiterRules);
	if (!profiles.ok) return <ProfileFailure diagnostics={profiles.diagnostics} />;
	if (props.arbiterRules && (!committed || committed.rules !== props.arbiterRules || !committed.active)) {
		return <PreparingRules />;
	}
	return (
		<RuntimeForm
			{...props}
			plugins={committed?.plugins ?? noPlugins}
			extensions={profiles.extensions}
			actions={profiles.actions}
		/>
	);
}

interface CommittedPlugin {
	readonly rules: NonNullable<SchemaFormRuntimeProps["arbiterRules"]>;
	readonly plugins: readonly FormPlugin<Record<string, unknown>, Record<string, unknown>>[];
	active: boolean;
}

function useCommittedArbiterPlugin(rules: SchemaFormRuntimeProps["arbiterRules"]): CommittedPlugin | undefined {
	const [committed, setCommitted] = useState<CommittedPlugin>();
	useEffect(() => {
		if (!rules) return;
		const owned = createArbiterPlugin({ rules });
		const detached = { ...owned, onDispose: undefined };
		const next: CommittedPlugin = { rules, plugins: [detached], active: true };
		setCommitted(next);
		return () => {
			next.active = false;
			owned.onDispose?.();
		};
	}, [rules]);
	return committed;
}

function RuntimeForm(
	props: SchemaFormRuntimeProps & {
		readonly plugins: readonly FormPlugin<Record<string, unknown>, Record<string, unknown>>[];
		readonly extensions: ReturnType<typeof resolveTrustedRuntimeProfiles>["extensions"];
		readonly actions: ReturnType<typeof resolveTrustedRuntimeProfiles>["actions"];
	},
) {
	const [lastSubmission, setLastSubmission] = useState<Readonly<Record<string, unknown>>>();
	const prepared = useSchemaForm<Record<string, unknown>, Record<string, unknown>>(props.document.schema, {
		provider,
		side: "input",
		...(props.document.definition === null ? {} : { definition: props.document.definition }),
		initialData: props.document.initialData,
		initialUiState: props.initialUiState ?? {},
		plugins: props.plugins,
		onSubmit: async ({ payload }: SubmitExecutionContext<Record<string, unknown>, Record<string, unknown>>) => {
			const snapshot = immutableSnapshot(payload);
			setLastSubmission(snapshot);
			props.onSubmit?.(snapshot);
			return { ok: true, submitId: "demo-submit" };
		},
	});
	return (
		<>
			<section
				className="schema-demo-form mt-6 rounded-lg border border-border bg-card p-5"
				aria-label="Interactive form"
				data-repeater-demo={
					props.document.definition?.id === "array-items" || props.document.definition?.id === "order-entry"
						? props.document.definition.id
						: undefined
				}
			>
				<h2 className="mb-4 font-semibold">Interactive form and runtime diagnostics</h2>
				<FormRenderer {...prepared} extensions={props.extensions} actions={props.actions} />
				{(props.actionControls ?? "host") === "host" ? <HostActions prepared={prepared} /> : null}
			</section>
			{props.showObservability ? <RuntimePanels prepared={prepared} lastSubmission={lastSubmission} /> : null}
		</>
	);
}

function HostActions({
	prepared,
}: { readonly prepared: UseSchemaFormResult<Record<string, unknown>, Record<string, unknown>> }) {
	return (
		<div className="schema-demo-actions mt-5 flex gap-3 border-t border-border pt-4">
			<button type="button" onClick={() => void prepared.form.submit().catch(() => undefined)}>
				Submit
			</button>
			<button type="button" onClick={() => prepared.form.reset()}>
				Reset
			</button>
		</div>
	);
}

function RuntimePanels(props: {
	readonly prepared: UseSchemaFormResult<Record<string, unknown>, Record<string, unknown>>;
	readonly lastSubmission?: Readonly<Record<string, unknown>>;
}) {
	const state = useFormSelector(props.prepared.form, observableState, structuredEqual);
	return (
		<div className="mt-6 grid gap-4 lg:grid-cols-2">
			<JsonPanel title="Current form data" value={state.data} />
			<StatusPanel status={state.status} issues={state.issues} dirty={state.dirty} />
			<JsonPanel title="Preparation diagnostics" value={props.prepared.diagnostics} />
			<JsonPanel
				title="Last successful submission"
				value={props.lastSubmission}
				empty="No successful submission yet."
			/>
		</div>
	);
}

function observableState(state: FormState<Record<string, unknown>, Record<string, unknown>>) {
	return {
		data: state.data,
		issues: state.issues,
		status: state.meta.submission?.status ?? "idle",
		dirty: Object.values(state.fieldMeta).some(({ dirty }) => dirty),
	};
}

function JsonPanel(props: { readonly title: string; readonly value?: unknown; readonly empty?: string }) {
	const headingId = useId();
	return (
		<section className="rounded-lg border border-border bg-card p-4" aria-labelledby={headingId} aria-live="polite">
			<h2 id={headingId} className="font-semibold">
				{props.title}
			</h2>
			{props.value === undefined ? (
				<p className="mt-2 text-sm text-muted-foreground">{props.empty}</p>
			) : (
				<pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(props.value, null, 2)}</pre>
			)}
		</section>
	);
}

function StatusPanel(props: { readonly status: string; readonly issues: readonly unknown[]; readonly dirty: boolean }) {
	return (
		<section
			className="rounded-lg border border-border bg-card p-4"
			aria-label="Core validation issues and submission status"
		>
			<h2 className="font-semibold">Core issues and submission status</h2>
			<output aria-live="polite" className="mt-2 block text-sm">
				Status: {props.status}; {props.issues.length} issue(s); {props.dirty ? "dirty" : "pristine"}.
			</output>
			<pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(props.issues, null, 2)}</pre>
		</section>
	);
}

function PreparingRules() {
	return (
		<section className="schema-demo-form mt-6 rounded-lg border border-border bg-card p-5" aria-busy="true">
			<output aria-live="polite">Preparing rule-governed form.</output>
		</section>
	);
}

function ProfileFailure(props: { readonly diagnostics: readonly unknown[] }) {
	return (
		<section role="alert" className="mt-6 rounded-lg border border-destructive p-5">
			<h2 className="font-semibold">Trusted runtime profile rejected</h2>
			<pre>{JSON.stringify(props.diagnostics, null, 2)}</pre>
		</section>
	);
}

function immutableSnapshot<T>(value: T): T {
	return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
