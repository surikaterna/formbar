import type {
	DataContext,
	DirectWriteRequest,
	DirectWriteResult,
	FormbarDataStrategyV1,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";

/** TEST ONLY: JSON request/response boundary, never a shipped endpoint or a browser grant. */
export function repeaterWire(host: FormbarDataStrategyV1): {
	strategy: FormbarDataStrategyV1;
	requests: string[];
	open: (instance: object) => object;
	handle: (wire: string, session: object) => string;
} {
	const objects = new Map<string, object>();
	const keys = new Map<object, string>();
	const sessions = new Map<object, object>();
	const active = new Map<object, object>();
	const requests: string[] = [];
	const open = (instance: object) => {
		let session = active.get(instance);
		if (!session) {
			session = {};
			active.set(instance, session);
			sessions.set(session, instance);
		}
		return session;
	};
	const key = (object: object) => {
		let id = keys.get(object);
		if (!id) {
			id = `opaque-${keys.size + 1}`;
			keys.set(object, id);
			objects.set(id, object);
		}
		return id;
	};
	const result = (status: DirectWriteResult["status"]) => JSON.stringify({ status });
	const handle = (wire: string, session: object): string => {
		if (Buffer.byteLength(wire) > 4096) return result("invalid-target");
		try {
			const instance = sessions.get(session);
			if (!instance) return result("denied");
			const raw: unknown = JSON.parse(wire);
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result("invalid-target");
			const data = raw as Record<string, unknown>;
			if (
				Object.keys(data).sort().join() !==
				"contract,form,instance,outer,reference,revision,row,rowRevision,targetKind,value"
			)
				return result("invalid-target");
			if (data.contract !== "formbar-direct-write-v1" || data.targetKind !== "row") return result("invalid-target");
			if (
				JSON.stringify(data.reference) !==
				JSON.stringify({ namespace: "data", path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "quantity"] })
			)
				return result("invalid-target");
			if (typeof data.value !== "string" || typeof data.form !== "string") return result("invalid-target");
			// Session ownership is established out of band; never derive host context from the request.
			if (data.form !== key(instance) || data.instance !== key(instance)) return result("stale");
			const revision = objects.get(data.revision as string);
			const outer = objects.get(data.outer as string);
			const row = objects.get(data.row as string);
			const rowRevision = objects.get(data.rowRevision as string);
			if (!revision || !outer || !row || !rowRevision) return result("invalid-target");
			const context: DataContext = { instance, policyGeneration: "g1", policyFingerprint: "host" };
			const request: DirectWriteRequest = {
				contract: "formbar-direct-write-v1",
				targetKind: "row",
				expectedInstance: instance,
				expectedRevision: revision,
				expectedRowRevision: rowRevision,
				reference: { namespace: "data", path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "quantity"] },
				scope: {
					rows: [
						{ name: "outer", token: outer },
						{ name: "inner", token: row },
					],
				},
				value: data.value,
			};
			return result(host.writeDirect?.(context, request).status ?? "unsupported");
		} catch {
			return result("invalid-target");
		}
	};
	const strategy: FormbarDataStrategyV1 = {
		...host,
		writeDirect(context, request) {
			if (request.targetKind !== "row" || request.scope.rows.length !== 2) return { status: "invalid-target" };
			const [outer, inner] = request.scope.rows;
			if (!outer || !inner) return { status: "invalid-target" };
			const wire = JSON.stringify({
				contract: request.contract,
				targetKind: request.targetKind,
				form: key(context.instance),
				instance: key(request.expectedInstance),
				revision: key(request.expectedRevision),
				outer: key(outer.token),
				row: key(inner.token),
				rowRevision: key(request.expectedRowRevision),
				reference: request.reference,
				value: request.value,
			});
			requests.push(wire);
			const response: unknown = JSON.parse(handle(wire, open(context.instance)));
			if (!response || typeof response !== "object" || Object.keys(response).join() !== "status")
				return { status: "denied" };
			return response as DirectWriteResult;
		},
	};
	return { strategy, requests, open, handle };
}
