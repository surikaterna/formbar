import type { CreateFormOptions } from "./state.js";

const KNOWN_CREATE_FORM_OPTIONS = {
	asyncValidators: true,
	clock: true,
	fieldDefaults: true,
	idGenerator: true,
	initialData: true,
	initialUiState: true,
	middleware: true,
	onSubmit: true,
	ownedScheduling: true,
	plugins: true,
	schema: true,
	stateStrategy: true,
	timeouts: true,
	transforms: true,
	uiStateSchema: true,
	validators: true,
} satisfies Record<keyof CreateFormOptions<unknown, unknown>, true>;

const ARBITER_RULES_WARNING =
	'[Formbar] The "arbiterRules" option is no longer supported. Use plugins: [createArbiterPlugin({ rules })] from "@formbar/arbiter" instead.';

export interface WarningEnvironment {
	readonly nodeEnv?: unknown;
}

export type WarningSink = (message: string) => void;

export function warnUnknownCreateFormOptions(
	options: unknown,
	environment: WarningEnvironment | undefined,
	warn: WarningSink,
): void {
	if (typeof environment?.nodeEnv !== "string" || environment.nodeEnv === "production") return;

	try {
		const unknownKeys = Object.keys(options as object)
			.filter((key) => !Object.hasOwn(KNOWN_CREATE_FORM_OPTIONS, key))
			.sort();
		if (unknownKeys.includes("arbiterRules")) warn(ARBITER_RULES_WARNING);
		const otherKeys = unknownKeys.filter((key) => key !== "arbiterRules");
		if (otherKeys.length > 0) warn(`[Formbar] Unknown createForm option(s): ${otherKeys.join(", ")}.`);
	} catch {
		// Diagnostics must never prevent form creation.
	}
}

function readWarningEnvironment(): WarningEnvironment | undefined {
	try {
		const processValue = (globalThis as { readonly process?: unknown }).process;
		if (typeof processValue !== "object" || processValue === null) return undefined;
		return { nodeEnv: (processValue as { readonly env?: { readonly NODE_ENV?: unknown } }).env?.NODE_ENV };
	} catch {
		return undefined;
	}
}

export function warnUnknownCreateFormOptionsAtRuntime(options: unknown): void {
	warnUnknownCreateFormOptions(options, readWarningEnvironment(), (message) => console.warn(message));
}
