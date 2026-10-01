import type { JsonValue, KaladaV1Host } from "@formbar/declarative";
import { createJsonSchemaValidator } from "@formbar/from-schema";
import { type FsxCompileOptions, type FsxDiagnostic, compileFsx } from "@formbar/fsx-authoring";
import { PLAYGROUND_DOCUMENT_VERSION, type PlaygroundDocument } from "../playground/contracts";
import {
	acceptDemoDraft,
	bindDemoDraft,
	captureDemoDraft,
	disposeDemoSession,
	installDemo,
	installDemoSession,
	invokeDemoDraft,
	retireDemoDraft,
} from "../runtime/kalada-demo-install";
import { createDemoStrategy } from "../runtime/kalada-demo-strategy";
import { schemaValueAllowed } from "../runtime/kalada-demo-value";
import { withArrayControls } from "./array-controls";
import type { FsxExample } from "./registry";

export function compileOptions(example: FsxExample): FsxCompileOptions {
	const identity = { generation: "fsx-authoring-v1", fingerprint: `fsx-demo-${example.id}` };
	const session = createDemoStrategy(identity, example.paths, {}, () => false);
	return {
		profile: "fsx-v1-experimental",
		...example.bindings,
		admission: {
			identity,
			strategy: session.strategy,
			policy: {
				...identity,
				widgets: {},
				renderers: {},
				actions: {},
				namespaces: { data: "available" },
				schema: { side: "input", availability: "complete", paths: example.paths },
				ui: { availability: "complete", paths: [] },
			},
		},
	};
}

function parseData(example: FsxExample, text: string): Record<string, unknown> {
	if (text.length > 100_000) throw new Error("Initial JSON exceeds 100,000 UTF-16 units");
	const value = JSON.parse(text, (key, child) => {
		if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsafe JSON key");
		return child;
	});
	if (!schemaValueAllowed(example.schema, value as JsonValue))
		throw new Error("Initial JSON does not match the fixed demo schema");
	if (createJsonSchemaValidator(example.schema)({ data: value, uiState: {} }).length)
		throw new Error("Initial JSON does not satisfy the fixed demo schema");
	return value;
}

export type ApplyResult =
	| { readonly ok: true; readonly document: PlaygroundDocument }
	| { readonly ok: false; readonly diagnostics: readonly FsxDiagnostic[] };

type Transfer = {
	readonly permit: object;
	readonly preset: string;
	readonly revision: object;
	readonly source: string;
	scope?: object;
	owner?: object;
};
const transfers = new WeakMap<PlaygroundDocument, Transfer>();

export function acceptFsxDocument(document: PlaygroundDocument, owner: object) {
	const transfer = transfers.get(document);
	if (!transfer) return;
	if (transfer.scope) throw new TypeError("Draft destination already accepted");
	transfer.scope = acceptDemoDraft(
		transfer.permit,
		document,
		owner,
		transfer.preset,
		transfer.revision,
		transfer.source,
	);
	transfer.owner = owner;
}

export function retireFsxDocument(document: PlaygroundDocument | undefined, owner: object) {
	const transfer = document && transfers.get(document);
	if (transfer?.scope) retireDemoDraft(transfer.scope, owner);
}

export function installFsxDocument(
	document: PlaygroundDocument,
	submit?: (data: Readonly<Record<string, unknown>>) => void,
	owner?: object,
) {
	const transfer = transfers.get(document);
	if (!transfer) return installDemo(document, submit);
	if (!transfer.scope || !owner || transfer.owner !== owner)
		throw new TypeError("Unaccepted or foreign draft destination");
	const use = invokeDemoDraft(transfer.scope, owner, transfer.preset, transfer.revision, transfer.source);
	return installDemoSession(document, submit, ["formbar.standard.v1"], undefined, {}, undefined, {}, use);
}

function preflightDocument(document: PlaygroundDocument) {
	const transfer = transfers.get(document);
	return transfer
		? installDemoSession(document, undefined, ["formbar.standard.v1"], undefined, {}, undefined, {}, transfer.permit)
		: installDemo(document);
}

function destination(
	example: FsxExample,
	definition: NonNullable<PlaygroundDocument["definition"]>,
	captured: { data: Record<string, unknown>; token?: object },
	source: string,
): PlaygroundDocument {
	const document: PlaygroundDocument = {
		version: PLAYGROUND_DOCUMENT_VERSION,
		schema: example.schema,
		definition,
		initialData: captured.data,
	};
	if (captured.token) {
		const revision = Object.freeze({});
		const permit = bindDemoDraft(captured.token, document, example.id, revision, source);
		transfers.set(document, { permit, revision, preset: example.id, source });
	}
	return document;
}

export function applyFsx(example: FsxExample, source: string, data: string): ApplyResult {
	return applyData(example, source, () => ({ data: parseData(example, data) }));
}

/** Only the session's current installed host supplies retained drafts; this is not an editable JSON mode. */
export function applyFsxFromHost(example: FsxExample, source: string, host: KaladaV1Host): ApplyResult {
	return applyData(example, source, () => captureDemoDraft(host, example.schema));
}

function applyData(
	example: FsxExample,
	source: string,
	capture: () => { data: Record<string, unknown>; token?: object },
): ApplyResult {
	const result = compileFsx(source, compileOptions(example));
	if (!result.ok) return result;
	try {
		const document = destination(example, withArrayControls(result.definition, example.schema), capture(), source);
		const host = preflightDocument(document);
		try {
			host.snapshot();
		} catch (error) {
			return {
				ok: false,
				diagnostics: [
					{
						code: "PREVIEW_EVALUATION_FAILED",
						path: "preview",
						message: error instanceof Error ? error.message : "Preview evaluation failed",
					},
				],
			};
		} finally {
			disposeDemoSession(host);
		}
		return { ok: true, document };
	} catch (error) {
		return {
			ok: false,
			diagnostics: [
				{
					code: "DEMO_INPUT_INVALID",
					path: "initialData/installation",
					message: error instanceof Error ? error.message : "Invalid initial data or destination installation",
				},
			],
		};
	}
}
