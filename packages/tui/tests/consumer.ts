import type {
	BindingResolution,
	BoundBindingResolution,
	ConflictedBindingResolution,
	DEFAULT_TUI_FIELD_ADAPTER_REGISTRY,
	DefaultBindingContribution,
	FormNavigationSession,
	FormbarTui,
	FormbarTuiProps,
	InteractionCleanup,
	InteractionTarget,
	LocalInteraction,
	NamedActionRegistration,
	NavigationModel,
	NavigationResult,
	ScopedInteractionCapability,
	TargetRegistration,
	TextInputSource,
	TuiCodecResult,
	TuiDiagnostic,
	TuiDiagnosticCode,
	TuiFieldAdapter,
	TuiFieldAdapterRegistry,
	TuiFieldCodec,
	TuiRendererInput,
	TuiSubmitFailureEvent,
	TuiSubmitSuccessEvent,
	TuiTheme,
	UnboundBindingResolution,
	createTuiFieldAdapterRegistry,
} from "@formbar/tui";
import type {
	StandaloneExitResult,
	StandaloneInput,
	StandaloneInputKey,
	StandaloneInstance,
	StandaloneOptions,
} from "@formbar/tui/standalone";
import type { normalizeStandaloneInput, renderStandaloneForm } from "@formbar/tui/standalone";

// @ts-expect-error Spike resolver policy is not public API.
import type { MemoryResolver } from "@formbar/tui";
// @ts-expect-error Spike debug instrumentation is not public API.
import type { DebugInstrumentation } from "@formbar/tui";
// @ts-expect-error Node host contracts are available only from the standalone subpath.
import type { StandaloneHostOptions as RootStandaloneHostOptions } from "@formbar/tui";

export interface ConsumerContract<TData, TUi> {
	readonly validCodecResult: TuiCodecResult<string>;
	readonly invalidCodecResult: TuiCodecResult<string>;
	readonly renderer: TuiRendererInput<TData, TUi>;
	readonly successEvent: TuiSubmitSuccessEvent<TData, TUi>;
	readonly failureEvent: TuiSubmitFailureEvent<TData, TUi>;
	readonly rendererComponent: typeof FormbarTui<TData, TUi>;
	readonly rendererProps: FormbarTuiProps<TData, TUi>;
	readonly navigation: NavigationModel;
	readonly navigationResult: NavigationResult<NavigationModel>;
	readonly navigationSession: FormNavigationSession;
	readonly theme: TuiTheme;
	readonly diagnostic: TuiDiagnostic;
	readonly diagnosticCode: TuiDiagnosticCode;
	readonly interaction: LocalInteraction;
	readonly target: InteractionTarget;
	readonly contribution: DefaultBindingContribution;
	readonly resolution: BindingResolution;
	readonly states: readonly [BoundBindingResolution, ConflictedBindingResolution, UnboundBindingResolution];
	readonly cleanup: InteractionCleanup;
	readonly targetRegistration: TargetRegistration;
	readonly actionRegistration: NamedActionRegistration;
	readonly capability: ScopedInteractionCapability;
	readonly textInput: TextInputSource;
	readonly adapter: TuiFieldAdapter;
	readonly codec: TuiFieldCodec;
	readonly registry: TuiFieldAdapterRegistry;
	readonly defaultRegistry: typeof DEFAULT_TUI_FIELD_ADAPTER_REGISTRY;
	readonly registryFactory: typeof createTuiFieldAdapterRegistry;
	readonly key: StandaloneInputKey;
	readonly input: StandaloneInput;
	readonly result: StandaloneExitResult;
	readonly instance: StandaloneInstance;
	readonly host: StandaloneOptions<TData, TUi>;
	readonly normalize: typeof normalizeStandaloneInput;
	readonly renderStandalone: typeof renderStandaloneForm<TData, TUi>;
	readonly absent: readonly [MemoryResolver, DebugInstrumentation, RootStandaloneHostOptions];
}

const validCodecResult: TuiCodecResult<string> = { ok: true, value: "value" };
const invalidCodecResult: TuiCodecResult<string> = { ok: false, code: "invalid-value" };
// @ts-expect-error Successful codec results require an own value in the public contract.
const malformedCodecResult: TuiCodecResult<string> = { ok: true };
void [validCodecResult, invalidCodecResult, malformedCodecResult];
