import type { ArbiterPluginOptions } from "@formbar/arbiter";
import type { CreateKaladaV1HostOptions, JsonValue } from "@formbar/declarative";
import { createDemoArbiter } from "./kalada-demo-arbiter";
import type { Context, DemoStore, Reference, Validators } from "./kalada-demo-store";

export type Node = Record<string, unknown>;
export type Authority = {
	schema?: Node;
	identity: CreateKaladaV1HostOptions["identity"];
	paths: readonly { readonly path: Reference["path"]; readonly kind: "array" | "value" }[];
	fields: Readonly<Record<string, Reference["path"]>>;
	valueAllowed: (ref: Reference, value: JsonValue) => boolean;
	definition?: Node;
	uiPaths?: readonly (readonly string[])[];
	arrayBounds?: Readonly<Record<string, { minItems?: number; maxItems?: number }>>;
	schemaValidator?: Validators[number];
	initialDraftAllowed?: (value: JsonValue) => boolean;
};

export class DemoSession {
	active = true;
	#grantEpoch = 0;
	get epoch() {
		return this.#grantEpoch;
	}
	instance?: object;
	arbiter: ReturnType<typeof createDemoArbiter>;
	constructor(
		readonly store: DemoStore,
		readonly authority: Authority,
		readonly submit?: (data: JsonValue) => void,
		ui: Readonly<Record<string, unknown>> = {},
		readonly rules?: ArbiterPluginOptions["rules"],
	) {
		this.arbiter = createDemoArbiter(rules, ui);
		this.arbiter.update(store.data);
	}
	granted(context: Context) {
		return (
			this.active &&
			context.instance === this.instance &&
			context.policyGeneration === this.authority.identity.generation &&
			context.policyFingerprint === this.authority.identity.fingerprint
		);
	}
	live(context: Context, revision: object) {
		return this.granted(context) && this.store.revision === revision;
	}
	allowed(ref: Reference, kind?: string) {
		return (
			ref.namespace === "data" &&
			this.authority.paths.some(
				(entry) => (!kind || entry.kind === kind) && JSON.stringify(entry.path) === JSON.stringify(ref.path),
			)
		);
	}
	publish(advance?: (revision: object) => boolean, beforeNotify?: (revision: object) => void) {
		this.arbiter.update(this.store.data);
		const revision = {};
		this.store.revision = revision;
		const accepted = advance?.(revision) ?? true;
		if (accepted) beforeNotify?.(revision);
		this.store.notify();
		return { revision, accepted };
	}
	revoke() {
		this.#grantEpoch++;
		this.active = false;
		this.arbiter.dispose();
		this.store.invalidate();
		this.store.scopedValidators = [];
		this.store.revision = {};
		this.store.subscribers.clear();
	}
}
