import type { FormApi } from "@formbar/core";
import { markAdapterFailure } from "./codec-runtime.js";
import type { MutableEditState } from "./edit-state.js";
import type { TuiFieldCodec } from "./field-adapters.js";
import type { InteractionCleanup, LocalInteraction, ScopedInteractionCapability } from "./interaction.js";
import type { FormNavigationSession } from "./navigation-session.js";
import type { NavigationModel } from "./navigation.js";
import { bindings } from "./renderer-bindings.js";
import {
	type SubmissionCallbackRefs,
	type SubmissionController,
	createSubmissionController,
} from "./submission-controller.js";

interface RuntimeInputs<TData, TUi> {
	readonly navigation: NavigationModel;
	readonly capability: ScopedInteractionCapability;
	readonly form: FormApi<TData, TUi>;
	readonly codecs: ReadonlyMap<string, TuiFieldCodec>;
	readonly disabled: ReadonlySet<string>;
	readonly callbacks: SubmissionCallbackRefs<TData, TUi>;
}

export interface InteractionRuntime {
	readonly act: (interaction: LocalInteraction) => boolean;
	readonly emit: () => void;
	readonly refresh: () => void;
	readonly getRevision: () => number;
	readonly releaseDefaults: InteractionCleanup;
	readonly disposed: { value: boolean };
	readonly submission: SubmissionController;
}

export function createInteractionRuntime<TData, TUi>(
	inputs: RuntimeInputs<TData, TUi>,
	session: FormNavigationSession,
	state: MutableEditState,
	listeners: Set<() => void>,
	handle: (interaction: LocalInteraction, submission: SubmissionController) => boolean,
): InteractionRuntime {
	let revision = 0;
	let defaultsCleanup: InteractionCleanup = () => undefined;
	const disposed = { value: false };
	const emit = () => {
		revision += 1;
		for (const listener of listeners) listener();
	};
	const refresh = () => {
		defaultsCleanup();
		defaultsCleanup = inputs.capability.contributeDefaultBindings(
			bindings(session, state, inputs.codecs, inputs.disabled),
		);
	};
	const submission = createSubmissionController({ ...inputs, session, emit });
	const act = (interaction: LocalInteraction) =>
		invokeAction(interaction, submission, state, disposed, handle, refresh, emit);
	return {
		act,
		emit,
		refresh,
		getRevision: () => revision,
		releaseDefaults: () => defaultsCleanup(),
		disposed,
		submission,
	};
}

function invokeAction(
	interaction: LocalInteraction,
	submission: SubmissionController,
	state: MutableEditState,
	disposed: { value: boolean },
	handle: (interaction: LocalInteraction, submission: SubmissionController) => boolean,
	refresh: () => void,
	emit: () => void,
): boolean {
	if (disposed.value) return false;
	let handled: boolean;
	try {
		handled = handle(interaction, submission);
	} catch {
		markAdapterFailure(state);
		handled = true;
	}
	if (!handled || disposed.value) return handled;
	refresh();
	emit();
	return true;
}
