import type { FormApi } from "@formbar/core";
import type { TuiDiagnostic } from "./contracts.js";
import type { ScopedInteractionCapability, TextInputSource } from "./interaction.js";
import type { NavigationModel } from "./navigation.js";
import type { RendererInteraction } from "./renderer-interaction.js";
import { mountRendererInteraction } from "./renderer-interaction.js";
import type { PreparedRenderer } from "./renderer-prepare.js";
import { validatePreparedValues } from "./renderer-prepare.js";
import type { SubmissionCallbackRefs } from "./submission-controller.js";

export interface MountedRenderer {
	readonly identities: readonly unknown[];
	readonly interaction?: RendererInteraction;
	readonly diagnostics?: readonly TuiDiagnostic[];
}

export type SetMountedRenderer = (
	value: MountedRenderer | undefined | ((current: MountedRenderer | undefined) => MountedRenderer | undefined),
) => void;

interface ControllerState {
	active: boolean;
	mounting: boolean;
	interaction: RendererInteraction | undefined;
}

export function mountRendererController<TData, TUi>(
	capability: ScopedInteractionCapability,
	form: FormApi<TData, TUi>,
	textInput: TextInputSource,
	prepared: PreparedRenderer,
	identities: readonly unknown[],
	setMounted: SetMountedRenderer,
	callbacks: SubmissionCallbackRefs<TData, TUi>,
): (() => void) | undefined {
	if (!prepared.navigation || prepared.diagnostics.length > 0) {
		setMounted(prepared.diagnostics.length > 0 ? undefined : { identities });
		return;
	}
	if (prepared.navigation.targets.length === 0) {
		setMounted({ identities });
		return;
	}
	const navigation = prepared.navigation;
	const state: ControllerState = { active: true, mounting: false, interaction: undefined };
	const mount = () => attemptMount(capability, form, textInput, prepared, navigation, identities, state, callbacks);
	const formCleanup = form.subscribe(() => reconcile(form, prepared, identities, state, mount, setMounted));
	const disposalCleanup = form.onDispose(() => {
		state.active = false;
		state.interaction?.dispose();
		state.interaction = undefined;
	});
	setMounted(mount());
	return () => {
		state.active = false;
		formCleanup();
		disposalCleanup();
		state.interaction?.dispose();
		setMounted((current) => (current?.identities === identities ? undefined : current));
	};
}

function attemptMount<TData, TUi>(
	capability: ScopedInteractionCapability,
	form: FormApi<TData, TUi>,
	textInput: TextInputSource,
	prepared: PreparedRenderer,
	navigation: NavigationModel,
	identities: readonly unknown[],
	state: ControllerState,
	callbacks: SubmissionCallbackRefs<TData, TUi>,
): MountedRenderer {
	state.mounting = true;
	try {
		const before = validatePreparedValues(prepared, form);
		if (before.length > 0) return { identities, diagnostics: before };
		state.interaction = mountRendererInteraction({
			navigation,
			capability,
			form,
			textInput,
			codecs: prepared.codecs,
			disabled: prepared.disabled,
			callbacks,
		});
		const after = validatePreparedValues(prepared, form);
		if (after.length === 0) return { identities, interaction: state.interaction };
		state.interaction.dispose();
		state.interaction = undefined;
		return { identities, diagnostics: after };
	} catch {
		state.interaction?.dispose();
		state.interaction = undefined;
		return { identities, diagnostics: [setupDiagnostic()] };
	} finally {
		state.mounting = false;
	}
}

function reconcile<TData, TUi>(
	form: FormApi<TData, TUi>,
	prepared: PreparedRenderer,
	identities: readonly unknown[],
	state: ControllerState,
	mount: () => MountedRenderer,
	setMounted: SetMountedRenderer,
): void {
	if (!state.active || state.mounting) return;
	const diagnostics = validatePreparedValues(prepared, form);
	if (diagnostics.length === 0) {
		if (!state.interaction) setMounted(mount());
		else state.interaction.notifyFormChange();
		return;
	}
	state.interaction?.dispose();
	state.interaction = undefined;
	setMounted({ identities, diagnostics });
}

function setupDiagnostic(): TuiDiagnostic {
	return { code: "invalid-renderer-input", severity: "error", message: "Renderer interaction setup failed" };
}
