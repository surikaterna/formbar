/** A target local to one rendered form. Strings are opaque host/application identifiers. */
export type InteractionTarget =
	| { readonly kind: "field"; readonly path: string }
	| { readonly kind: "group"; readonly id: string };

/** A logical, named action directed at a target in the capability's local scope. */
export interface LocalInteraction {
	readonly action: string;
	readonly target: InteractionTarget;
}

export interface DefaultBindingContribution {
	readonly input: string;
	readonly interaction: LocalInteraction;
	readonly label: string;
}

export interface BoundBindingResolution extends DefaultBindingContribution {
	readonly status: "bound";
}

export interface ConflictedBindingResolution {
	readonly input: string;
	readonly status: "conflicted";
}

export interface UnboundBindingResolution {
	readonly input: string;
	readonly status: "unbound";
}

export type BindingResolution = BoundBindingResolution | ConflictedBindingResolution | UnboundBindingResolution;

/** A cleanup is safe to call repeatedly and must not throw. */
export type InteractionCleanup = () => void;

export interface TargetRegistration {
	readonly target: InteractionTarget;
	readonly invoke: (action: string) => boolean;
}

export interface NamedActionRegistration {
	readonly id: string;
	readonly invoke: (interaction: LocalInteraction) => boolean;
}

/**
 * Process-free interaction facilities scoped by the host to one rendered form.
 * Registration batches are atomic: invalid batches throw synchronously without residue.
 */
export interface ScopedInteractionCapability {
	registerTargets(targets: readonly TargetRegistration[]): InteractionCleanup;
	registerActions(actions: readonly NamedActionRegistration[]): InteractionCleanup;
	contributeDefaultBindings(bindings: readonly DefaultBindingContribution[]): InteractionCleanup;
	getEffectiveBinding(input: string): BindingResolution;
	getRevision(): number;
	/** Subscribes to later revisions; registration does not synchronously emit an initial event. */
	subscribe(listener: () => void): InteractionCleanup;
}

/** Direct printable and paste text, deliberately separate from named control actions. */
export interface TextInputSource {
	subscribe(listener: (text: string) => void): InteractionCleanup;
}
