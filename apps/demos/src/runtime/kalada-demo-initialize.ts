import type { JsonValue, KaladaV1Host } from "@formbar/declarative";
import { copyJson } from "@formbar/expressions";
import type { PlaygroundDocument } from "../playground/contracts";
import {
	captureInitialPayload,
	ownInitialValue,
	stageInitialData,
	validateInitialPaths,
} from "./kalada-demo-initial-data";
import { initialTypeAllowed } from "./kalada-demo-initial-types";
import type { Node } from "./kalada-demo-schema";
import type { DemoSession } from "./kalada-demo-session";
import { empty } from "./kalada-demo-state";
import type { Context, Strategy } from "./kalada-demo-store";
import { schemaValueAllowed } from "./kalada-demo-value";

type DraftCapture = {
	readonly source: KaladaV1Host;
	readonly revision: object;
	readonly schema: Node;
	readonly snapshot: JsonValue;
	readonly bytes: string;
	readonly schemaSnapshot: Node;
	readonly schemaBytes: string;
	readonly preset: string;
	readonly formId: string;
};
type DraftBinding = {
	readonly capture: DraftCapture;
	readonly document: PlaygroundDocument;
	readonly bytes: string;
	readonly preset: string;
	readonly sourceRevision: object;
	readonly source: string;
	accepted: boolean;
};
type DraftScope = {
	readonly binding: DraftBinding;
	readonly owner: object;
	readonly retirements: Set<() => void>;
	active: boolean;
};
type DraftInvocation = { readonly scope: DraftScope };
const record = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);
const own = (value: object, key: string): unknown => {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !("value" in descriptor)) throw new TypeError("Draft metadata must be own data");
	return descriptor.value;
};
const jsonBytes = (value: unknown) => JSON.stringify(copyJson(value));
function formId(value: unknown): string {
	const definition = copyJson(value);
	if (!record(definition) || typeof definition.id !== "string") throw new TypeError("Invalid draft form identity");
	return definition.id;
}

/** Captures, preflight permits and mounted destination scopes never share a bearer capability. */
export class DemoDraftPort {
	#captures = new WeakMap<object, DraftCapture>();
	#preflights = new WeakMap<object, DraftBinding>();
	#scopes = new WeakMap<object, DraftScope>();
	#invocations = new WeakMap<object, DraftInvocation>();
	#pendingInstalls = new WeakMap<object, DraftScope>();
	constructor(
		private readonly owns: (host: KaladaV1Host, schema: Node) => boolean,
		private readonly presetFor: (schema: Node) => string | undefined,
	) {}

	capture(source: KaladaV1Host, schema: Node, revision: object, data: unknown) {
		if (!this.owns(source, schema) || source.currentRevision() !== revision) throw new TypeError("Stale draft origin");
		const snapshot = copyJson(data);
		const schemaSnapshot = copyJson(schema);
		const preset = this.presetFor(schema);
		const bytes = JSON.stringify(snapshot);
		if (
			!preset ||
			!record(snapshot) ||
			!record(schemaSnapshot) ||
			!schemaValueAllowed(schemaSnapshot, snapshot) ||
			bytes.length > 100_000
		)
			throw new TypeError("Invalid or oversized installed draft");
		const definitionId = formId(source.definition);
		if (source.currentRevision() !== revision) throw new TypeError("Draft changed during capture");
		const token = Object.freeze({});
		this.#captures.set(
			token,
			Object.freeze({
				source,
				schema,
				revision,
				snapshot,
				bytes,
				schemaSnapshot,
				schemaBytes: JSON.stringify(schemaSnapshot),
				preset,
				formId: definitionId,
			}),
		);
		return { token, data: structuredClone(snapshot) };
	}

	bindCapture(token: object, document: PlaygroundDocument, preset: string, sourceRevision: object, source: string) {
		const capture = this.#captures.get(token);
		if (
			!capture ||
			typeof preset !== "string" ||
			typeof source !== "string" ||
			typeof sourceRevision !== "object" ||
			!sourceRevision
		)
			throw new TypeError("Invalid owned draft capability");
		this.live(capture);
		const bytes = jsonBytes(document);
		if (own(document, "schema") !== capture.schema || jsonBytes(own(document, "initialData")) !== capture.bytes)
			throw new TypeError("Modified captured draft");
		if (preset !== capture.preset || formId(own(document, "definition")) !== capture.formId)
			throw new TypeError("Foreign draft preset or form");
		this.live(capture);
		const binding = { capture, document, bytes, preset, sourceRevision, source, accepted: false };
		const permit = Object.freeze({});
		this.#captures.delete(token);
		this.#preflights.set(permit, binding);
		return permit;
	}

	accept(
		permit: object,
		document: PlaygroundDocument,
		owner: object,
		preset: string,
		sourceRevision: object,
		source: string,
	) {
		const binding = this.#preflights.get(permit);
		if (!binding || binding.accepted || typeof owner !== "object" || !owner)
			throw new TypeError("Draft grant already redeemed or invalid");
		this.intended(binding, document);
		this.intent(binding, preset, sourceRevision, source);
		this.live(binding.capture);
		const scope = Object.freeze({});
		binding.accepted = true;
		this.#preflights.delete(permit);
		this.#scopes.set(scope, { binding, owner, active: true, retirements: new Set() });
		return scope;
	}

	invocation(scope: object, owner: object, preset: string, sourceRevision: object, source: string) {
		const destination = this.#scopes.get(scope);
		if (!destination?.active || destination.owner !== owner)
			throw new TypeError("Foreign or retired draft destination");
		this.intended(destination.binding, destination.binding.document);
		this.intent(destination.binding, preset, sourceRevision, source);
		const invocation = Object.freeze({});
		this.#invocations.set(invocation, { scope: destination });
		return invocation;
	}

	authorization(document: PlaygroundDocument, use?: object) {
		if (!use) return;
		const preflight = this.#preflights.get(use);
		const invocation = this.#invocations.get(use);
		const binding = preflight ?? invocation?.scope.binding;
		if (!binding || (invocation && !invocation.scope.active)) throw new TypeError("Invalid owned draft capability");
		this.intended(binding, document);
		if (preflight) this.live(binding.capture);
		if (invocation) {
			this.#invocations.delete(use);
			this.#pendingInstalls.set(use, invocation.scope);
		}
		const capture = binding.capture;
		return (value: JsonValue) => {
			this.intended(binding, document);
			if (preflight) this.live(capture);
			return (
				(!invocation || invocation.scope.active) &&
				schemaValueAllowed(capture.schemaSnapshot, value) &&
				jsonBytes(value) === capture.bytes
			);
		};
	}

	installed(use: object | undefined, host: KaladaV1Host, retire: () => void) {
		if (!use) return;
		const scope = this.#pendingInstalls.get(use);
		if (!scope) return;
		this.#pendingInstalls.delete(use);
		if (!scope.active || !host.currentRevision()) {
			retire();
			throw new TypeError("Retired draft destination");
		}
		scope.retirements.add(retire);
	}

	retire(scope: object, owner: object) {
		const destination = this.#scopes.get(scope);
		if (!destination || destination.owner !== owner) throw new TypeError("Foreign draft retirement");
		destination.active = false;
		for (const retire of destination.retirements) retire();
		destination.retirements.clear();
	}

	private live(capture: DraftCapture) {
		if (
			!this.owns(capture.source, capture.schema) ||
			capture.source.currentRevision() !== capture.revision ||
			jsonBytes(capture.schema) !== capture.schemaBytes
		)
			throw new TypeError("Stale or revoked draft origin");
	}
	private intended(binding: DraftBinding, document: PlaygroundDocument) {
		if (
			binding.document !== document ||
			own(document, "schema") !== binding.capture.schema ||
			jsonBytes(document) !== binding.bytes
		)
			throw new TypeError("Foreign or modified draft destination");
	}
	private intent(binding: DraftBinding, preset: string, sourceRevision: object, source: string) {
		if (binding.preset !== preset || binding.sourceRevision !== sourceRevision || binding.source !== source)
			throw new TypeError("Foreign preset or source revision");
	}
}

type Request = Parameters<NonNullable<Strategy["initializeSchema"]>>[1];
function prepareInitial(session: DemoSession, request: Request) {
	const candidate = stageInitialData(session, captureInitialPayload(request));
	validateInitialPaths(session, candidate);
	const typeAllowed = session.authority.initialDraftAllowed
		? session.authority.initialDraftAllowed(candidate)
		: !session.authority.schema || initialTypeAllowed(session.authority.schema, candidate);
	if (!typeAllowed) throw new TypeError("Invalid initial schema type");
	const baseline = structuredClone(copyJson(candidate));
	const data = structuredClone(baseline);
	return { baseline, data, arbiter: session.arbiter.stage(baseline) };
}

function commitInitial(session: DemoSession, prepared: ReturnType<typeof prepareInitial>) {
	const { store } = session;
	const previous = session.arbiter;
	const revision = {};
	// All staged work and authorization checks finish before the first live assignment or callback.
	session.arbiter = prepared.arbiter;
	store.data = prepared.data;
	store.initial = prepared.baseline;
	store.revision = revision;
	store.rows.clear();
	store.fields.clear();
	store.issueRecords = [];
	store.scopedIssues.clear();
	store.status = empty();
	store.invalidate();
	previous.dispose();
	store.notify();
	return { status: "applied" as const, revision };
}

export function initializeDemo(
	session: DemoSession,
	context: Context,
	request: Parameters<NonNullable<Strategy["initializeSchema"]>>[1],
) {
	const { store } = session;
	const revision = store.revision;
	const epoch = session.epoch;
	let prepared: ReturnType<typeof prepareInitial>;
	try {
		if (
			!session.live(context, revision) ||
			ownInitialValue(request, "revision") !== revision ||
			ownInitialValue(request, "instance") !== context.instance
		)
			return { status: "stale" as const };
		if (ownInitialValue(request, "contract") !== "formbar-schema-initialization-v1")
			return { status: "denied" as const };
		prepared = prepareInitial(session, request);
	} catch {
		return { status: "denied" as const };
	}
	if (!session.live(context, revision) || session.epoch !== epoch) {
		prepared.arbiter.dispose();
		return { status: "stale" as const };
	}
	return commitInitial(session, prepared);
}
