import { type ArbiterPluginOptions, createArbiterPlugin } from "@formbar/arbiter";
import type { JsonValue } from "@formbar/declarative";
import {
	fieldPolicyKey,
	fieldPolicyProperties,
	managedFieldPolicies,
	managedPolicyUi,
} from "./kalada-demo-managed-policy";

type Rules = ArbiterPluginOptions["rules"];
export interface DemoArbiter {
	update(data: JsonValue): void;
	read(path: readonly (string | number)[]): JsonValue | undefined;
	dispose(): void;
	stage(data: JsonValue): DemoArbiter;
}

function evaluate(plugin: ReturnType<typeof createArbiterPlugin>, data: JsonValue, ui: Record<string, JsonValue>) {
	return plugin.evaluate?.({
		action: { type: "demo.sync" },
		data,
		prevData: data,
		uiState: ui,
		prevUiState: ui,
		change: { path: undefined, type: "demo.sync", dataChanged: true, uiChanged: true },
		issues: [],
		origin: "user",
		getValueAtPath: () => undefined,
	});
}

/** Only trusted host rules run; source JSON cannot register a plugin or a callback. */
export function createDemoArbiter(rules: Rules, initial: Readonly<Record<string, unknown>>): DemoArbiter {
	const plugin = rules?.length ? createArbiterPlugin({ rules }) : undefined;
	const managed = managedPolicyUi(managedFieldPolicies(rules));
	const base = structuredClone(initial) as Record<string, JsonValue>;
	let ui = { ...base };
	const update = (data: JsonValue) => {
		ui = { ...base, ...ui, ...managed };
		if (!plugin?.evaluate) return;
		if (!data || typeof data !== "object" || Array.isArray(data)) return;
		const result = evaluate(plugin, data, ui);
		if (!result) return;
		for (const policy of result.fieldPolicy ?? []) {
			if (typeof policy.path !== "string" || !policy.path.startsWith("/") || policy.path.slice(1).includes("/"))
				continue;
			for (const property of fieldPolicyProperties) {
				const name = fieldPolicyKey(property, policy.path.slice(1));
				if (Object.hasOwn(managed, name) && typeof policy[property] === "boolean") ui[name] = policy[property];
			}
		}
		for (const write of result.writes ?? []) {
			if (!write.path.startsWith("$ui.")) continue;
			const name = write.path.slice(4);
			if (Object.hasOwn(base, name) && !name.includes(".")) ui[name] = write.value as JsonValue;
		}
	};
	return {
		update,
		read: (path: readonly (string | number)[]) => (path.length === 1 ? ui[String(path[0])] : undefined),
		dispose: () => plugin?.onDispose?.(),
		stage(data) {
			const next = createDemoArbiter(rules, ui);
			try {
				next.update(data);
				return next;
			} catch (error) {
				next.dispose();
				throw error;
			}
		},
	};
}
