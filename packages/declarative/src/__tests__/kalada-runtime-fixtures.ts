import { serialHost } from "../../../../scripts/kalada-preflight/fixtures/row-write-hosts.js";
import { createFormRuntime, validateFormDefinition } from "../index.js";

const identity = { generation: "g1", fingerprint: "host" };
const target = { namespace: "data" as const, segments: ["profile", "name"] };
export const program = (expression: unknown) => ({
	format: "kalada-program" as const,
	version: 1 as const,
	profile: "kalada-v1" as const,
	expression,
});

export function installedField(extra: Record<string, unknown> = {}) {
	const host = serialHost();
	const candidate = {
		version: 1,
		id: "installed-field",
		root: { id: "name", type: "field", widget: "text", binding: target, ...extra },
	};
	const admission = {
		policy: {
			...identity,
			widgets: {},
			renderers: {},
			actions: {},
			namespaces: { data: "available" },
			schema: { side: "input", availability: "complete", paths: [{ path: target.segments, kind: "value" }] },
			ui: { availability: "complete", paths: [] },
		},
		identity,
		strategy: host.strategy,
		writeSources: { "root.binding": "profile.name" },
		directLocations: {
			"root.binding": {
				profile: {
					target: { namespace: "data", segments: ["profile"] },
					type: { kind: "primitive-type", name: "json" },
					writable: true,
					properties: { name: { type: { kind: "primitive-type", name: "string" }, writable: true } },
				},
			},
		},
	};
	const admit = (input: unknown) => validateFormDefinition(input, admission);
	const admitOutput = (input: unknown) => validateFormDefinition(input, { ...admission, writeSources: {} });
	const result = admit(candidate);
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	const runtime = createFormRuntime({ definition: result.value });
	const state = host.states.get(result.value.prepared.context.instance);
	if (!state) throw new Error("Host installation did not bind the form instance");
	return { runtime, state, host, candidate, admit, admitOutput };
}

export function installedOutput(expression: unknown) {
	const field = installedField();
	field.runtime.dispose();
	const candidate = {
		version: 1,
		id: "installed-output",
		root: { type: "output", id: "summary", format: "plain", value: program(expression) },
	};
	const result = field.admitOutput(candidate);
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	const runtime = createFormRuntime({ definition: result.value });
	const state = field.host.states.get(result.value.prepared.context.instance);
	if (!state) throw new Error("Host installation did not bind the output instance");
	return { runtime, state, host: field.host };
}
