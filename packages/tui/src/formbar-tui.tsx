import { createFormPresentation } from "@formbar/from-schema";
import type { FormPresentation, LayoutNode } from "@formbar/from-schema";
import { Box, Text } from "ink";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { TuiDiagnostic, TuiRendererInput, TuiSubmitFailureEvent, TuiSubmitSuccessEvent } from "./contracts.js";
import { DEFAULT_TUI_FIELD_ADAPTER_REGISTRY, type TuiFieldAdapterRegistry } from "./field-adapters.js";
import type { ScopedInteractionCapability, TextInputSource } from "./interaction.js";
import type { NavigationModel } from "./navigation.js";
import { type MountedRenderer, type SetMountedRenderer, mountRendererController } from "./renderer-controller.js";
import type { RendererInteraction } from "./renderer-interaction.js";
import { type PreparedRenderer, prepareRenderer } from "./renderer-prepare.js";
import { LayoutView, SelectOverlay } from "./renderer-views.js";
import type { SubmissionCallbackRefs } from "./submission-controller.js";
import { SubmissionView } from "./submission-views.js";
import { sanitizeTerminalText } from "./terminal-text.js";
import { DEFAULT_TUI_THEME, type TuiTheme } from "./theme.js";

export interface FormbarTuiProps<TData, TUi> extends TuiRendererInput<TData, TUi> {
	readonly capability: ScopedInteractionCapability;
	readonly layout: LayoutNode;
	readonly textInput: TextInputSource;
	readonly adapterRegistry?: TuiFieldAdapterRegistry | undefined;
	readonly viewportWidth: number;
	readonly theme?: TuiTheme | undefined;
	readonly autoFocusFirstError?: boolean | undefined;
	readonly onSubmitSuccess?: ((event: TuiSubmitSuccessEvent<TData, TUi>) => void) | undefined;
	readonly onSubmitFailure?: ((event: TuiSubmitFailureEvent<TData, TUi>) => void) | undefined;
}

export function FormbarTui<TData, TUi>(props: FormbarTuiProps<TData, TUi>) {
	const registry = props.adapterRegistry ?? DEFAULT_TUI_FIELD_ADAPTER_REGISTRY;
	const formState = useSyncExternalStore(props.form.subscribe, props.form.getState, props.form.getState);
	const presentation = createFormPresentation(
		{
			fields: props.schema.fields,
			layout: props.layout,
			metadata: props.schema.metadata,
			optionsByPath: props.schema.optionsByPath,
		},
		{
			uiState: (formState.uiState ?? {}) as Readonly<Record<string, unknown>>,
			issues: formState.issues,
		},
	);
	const structure = presentationStructure(presentation);
	const prepared = usePreparedRenderer(props, presentation, registry, structure);
	const [mounted, setMounted] = useState<MountedRenderer>();
	const callbacks = useRef({}) as SubmissionCallbackRefs<TData, TUi>;
	callbacks.current = {
		autoFocusFirstError: props.autoFocusFirstError ?? true,
		onSuccess: props.onSubmitSuccess,
		onFailure: props.onSubmitFailure,
		onDiagnostic: props.onDiagnostic,
	};
	const identities = useMemo(
		() => [props.capability, props.form, props.schema, props.layout, props.textInput, registry, structure],
		[props.capability, props.form, props.schema, props.layout, props.textInput, registry, structure],
	);
	const diagnostics = owns(mounted, identities) && mounted.diagnostics ? mounted.diagnostics : prepared.diagnostics;
	useDiagnosticReporting(props, registry, diagnostics);
	useMount(props, prepared, identities, setMounted, callbacks);
	if (diagnostics.length > 0) return <BlockingDiagnostics diagnostics={diagnostics} theme={props.theme} />;
	if (owns(mounted, identities) && (prepared.navigation?.targets.length ?? 0) === 0)
		return <Text>No visible form fields</Text>;
	if (!owns(mounted, identities) || !mounted.interaction || !prepared.navigation)
		return <Text>Loading form navigation</Text>;
	return (
		<ReadyFormbarTui
			{...props}
			presentation={presentation}
			interaction={mounted.interaction}
			navigation={prepared.navigation}
		/>
	);
}

interface PreparedCache {
	readonly identities: readonly unknown[];
	readonly value: PreparedRenderer;
}

function usePreparedRenderer<TData, TUi>(
	props: FormbarTuiProps<TData, TUi>,
	presentation: FormPresentation,
	registry: TuiFieldAdapterRegistry,
	structure: string,
): PreparedRenderer {
	const cache = useRef<PreparedCache | undefined>(undefined);
	const identities = [props.layout, props.schema, props.form, registry, structure];
	if (!cache.current || !sameIdentities(cache.current.identities, identities)) {
		cache.current = { identities, value: prepareRenderer(presentation, props.schema, props.form, registry) };
	}
	return cache.current.value;
}

function sameIdentities(left: readonly unknown[], right: readonly unknown[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function useMount<TData, TUi>(
	props: FormbarTuiProps<TData, TUi>,
	prepared: ReturnType<typeof prepareRenderer<TData, TUi>>,
	identities: readonly unknown[],
	setMounted: SetMountedRenderer,
	callbacks: SubmissionCallbackRefs<TData, TUi>,
): void {
	const { capability, form, textInput } = props;
	useEffect(
		() => mountRendererController(capability, form, textInput, prepared, identities, setMounted, callbacks),
		[capability, form, textInput, prepared, identities, setMounted, callbacks],
	);
}

function ReadyFormbarTui<TData, TUi>(
	props: FormbarTuiProps<TData, TUi> & {
		readonly presentation: FormPresentation;
		readonly interaction: RendererInteraction;
		readonly navigation: NavigationModel;
	},
) {
	useSyncExternalStore(props.interaction.subscribe, props.interaction.getRevision, props.interaction.getRevision);
	const selected = props.interaction.session.getSelectedTarget();
	const general = props.navigation.groups.find(({ synthetic }) => synthetic);
	const theme = props.theme ?? DEFAULT_TUI_THEME;
	return (
		<Box flexDirection="column">
			<LayoutView
				node={props.presentation.layout ?? props.layout}
				selected={selected}
				general={general}
				form={props.form}
				presentation={props.presentation}
				interaction={props.interaction}
				theme={theme}
				width={props.viewportWidth}
			/>
			<ActionHelp labels={props.interaction.getAvailableActions()} theme={theme} />
			<SubmissionView interaction={props.interaction} schema={props.schema} theme={theme} />
			<SelectOverlay interaction={props.interaction} theme={theme} />
		</Box>
	);
}

function presentationStructure(presentation: FormPresentation): string {
	return presentation.fields
		.map(({ path, state }) => `${path}:${Number(state.visible)}${Number(state.readOnly)}${Number(state.disabled)}`)
		.join("|");
}

export function BlockingDiagnostics({
	diagnostics,
	theme = DEFAULT_TUI_THEME,
}: { readonly diagnostics: readonly TuiDiagnostic[]; readonly theme?: TuiTheme | undefined }) {
	return (
		<Text {...theme.error}>
			Cannot render form: {diagnostics.map(({ message }) => sanitizeTerminalText(message)).join("; ")}
		</Text>
	);
}

export function ActionHelp({
	labels,
	theme = DEFAULT_TUI_THEME,
}: { readonly labels: readonly string[]; readonly theme?: TuiTheme | undefined }) {
	return labels.length > 0 ? (
		<Text {...theme.help}>Actions: {labels.map(sanitizeTerminalText).join(" | ")}</Text>
	) : null;
}

function owns(mounted: MountedRenderer | undefined, identities: readonly unknown[]): mounted is MountedRenderer {
	return mounted !== undefined && sameIdentities(mounted.identities, identities);
}

function useDiagnosticReporting<TData, TUi>(
	props: FormbarTuiProps<TData, TUi>,
	registry: TuiFieldAdapterRegistry,
	diagnostics: readonly TuiDiagnostic[],
): void {
	const reported = useRef<readonly unknown[] | undefined>(undefined);
	const signature = diagnostics.map(({ code, path, message }) => `${code}:${path ?? ""}:${message}`).join("|");
	const { form, schema, layout, capability, textInput, onDiagnostic } = props;
	useEffect(() => {
		if (diagnostics.length === 0) {
			reported.current = undefined;
			return;
		}
		if (!onDiagnostic) return;
		const identity = [form, schema, layout, capability, textInput, registry, signature];
		if (reported.current?.every((value, index) => value === identity[index])) return;
		reported.current = identity;
		for (const item of diagnostics) onDiagnostic(sanitizeDiagnostic(item));
	}, [form, schema, layout, capability, textInput, registry, onDiagnostic, signature, diagnostics]);
}

function sanitizeDiagnostic(diagnostic: TuiDiagnostic): TuiDiagnostic {
	return {
		...diagnostic,
		message: sanitizeTerminalText(diagnostic.message),
		...(diagnostic.path === undefined ? {} : { path: sanitizeTerminalText(diagnostic.path) }),
	};
}
