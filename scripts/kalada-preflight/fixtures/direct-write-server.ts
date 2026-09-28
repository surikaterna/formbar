import type {
	DataContext,
	DirectWriteRequest,
	DirectWriteResult,
	FormbarDataStrategyV1,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { KALADA_RUNTIME_ARTIFACT } from "../../../packages/declarative/src/validators/kalada-private-runtime.js";

const maxWireBytes = 4096;
const invalid: DirectWriteResult = { status: "invalid-target" };
const denied: DirectWriteResult = { status: "denied" };

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	if (Object.getPrototypeOf(value) !== Object.prototype) return false;
	const own = Reflect.ownKeys(value);
	return (
		own.length === keys.length &&
		keys.every(
			(key) => Object.getOwnPropertyDescriptor(value, key)?.value !== undefined && Object.hasOwn(value, key),
		) &&
		own.every((key) => typeof key === "string" && keys.includes(key))
	);
}

function parseWire(wire: string): unknown {
	if (Buffer.byteLength(wire) > maxWireBytes) return undefined;
	try {
		return JSON.parse(wire) as unknown;
	} catch {
		return undefined;
	}
}

function validRequest(request: unknown): request is Record<string, unknown> & { value: number } {
	if (!record(request, ["contract", "targetKind", "instance", "revision", "reference", "scope", "value"])) return false;
	const ref = request.reference;
	const scope = request.scope;
	return (
		request.contract === "formbar-direct-write-v1" &&
		request.targetKind === "non-repeater" &&
		typeof request.instance === "string" &&
		Number.isSafeInteger(request.revision) &&
		record(ref, ["namespace", "path"]) &&
		ref.namespace === "data" &&
		Array.isArray(ref.path) &&
		ref.path.length === 2 &&
		ref.path[0] === "order" &&
		ref.path[1] === "total" &&
		record(scope, ["rows"]) &&
		Array.isArray(scope.rows) &&
		scope.rows.length === 0 &&
		typeof request.value === "number" &&
		Number.isFinite(request.value) &&
		request.value >= 0 &&
		request.value <= 100
	);
}

function validResponse(response: unknown): response is DirectWriteResult {
	return (
		record(response, ["status"]) &&
		typeof response.status === "string" &&
		["applied", "denied", "missing", "stale", "conflict", "invalid-target", "unsupported"].includes(response.status)
	);
}

/** TEST ONLY: serialized transport + authoritative host, NOT a shipped server endpoint. */
export function directWriteServer() {
	let instance: object | undefined;
	let revision: object = {};
	let sequence = 1;
	let value = 4;
	let submitted = { order: { total: 4 }, untouched: "retained" };
	let grant = true;
	let readOnly = false;
	let removed = false;
	let conflict = false;
	let notices = 0;
	let subscriber = () => {};
	const requests: string[] = [];
	const responses: string[] = [];
	let injectedResponse: string | undefined;
	const host = (wire: string): string => {
		const request = parseWire(wire);
		let status: DirectWriteResult["status"] = "invalid-target";
		if (!validRequest(request)) status = "invalid-target";
		else if (request.instance !== "form-1" || request.revision !== sequence) status = "stale";
		else if (!grant || readOnly) status = "denied";
		else if (removed) status = "missing";
		else if (conflict) status = "conflict";
		else {
			value = request.value;
			submitted = { order: { total: value }, untouched: "retained" };
			revision = {};
			sequence++;
			notices++;
			subscriber();
			status = "applied";
		}
		const response = JSON.stringify({ status });
		responses.push(response);
		return response;
	};
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => ({ artifact: KALADA_RUNTIME_ARTIFACT, policyGeneration: "g1", policyFingerprint: "host" }),
		capture: (context) => {
			instance ??= context.instance;
			return { token: revision, instance: context.instance, read: () => ({ status: "found", value }) };
		},
		current: () => revision,
		subscribe: (_context, invalidate) => {
			subscriber = invalidate;
			return () => {
				subscriber = () => {};
			};
		},
		writeDirect: (context: DataContext, request: DirectWriteRequest): DirectWriteResult => {
			let message: string;
			try {
				message = JSON.stringify({
					contract: request.contract,
					targetKind: request.targetKind,
					instance: request.expectedInstance === instance && context.instance === instance ? "form-1" : "other",
					revision: request.expectedRevision === revision ? sequence : sequence - 1,
					reference: request.reference,
					scope: request.scope,
					value: request.value,
				});
			} catch {
				return invalid;
			}
			if (!validRequest(parseWire(message))) return invalid;
			requests.push(message);
			const response = parseWire(injectedResponse ?? host(message));
			injectedResponse = undefined;
			return validResponse(response) ? response : denied;
		},
	};
	return {
		strategy,
		requests,
		responses,
		state: () => ({ value, revision, submitted, notices }),
		setGrant: (next: boolean) => {
			grant = next;
		},
		setReadOnly: (next: boolean) => {
			readOnly = next;
		},
		setRemoved: (next: boolean) => {
			removed = next;
		},
		setConflict: (next: boolean) => {
			conflict = next;
		},
		rotate: () => {
			revision = {};
			sequence++;
		},
		setResponse: (wire: string) => {
			injectedResponse = wire;
		},
		host,
	};
}
