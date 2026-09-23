import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ResolvedActionState } from "@formbar/declarative";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { RepeaterIntentListener } from "../repeater-coordinator.js";
import { RepeaterCoordinator, bindingKey } from "../repeater-coordinator.js";

function state(action: ResolvedActionState["action"], value: unknown): ResolvedActionState {
	return {
		type: "action",
		action,
		payload: { status: "ready", value },
		target: { namespace: "data", segments: ["rows"] },
		instance: { nodeId: "action", instanceKey: "action", scopes: [{ scope: "row", index: 0 }] },
	} as ResolvedActionState;
}

function listener() {
	return {
		apply: vi.fn(),
		finish: vi.fn(),
		reset: vi.fn(),
	} satisfies RepeaterIntentListener;
}

function oversizedFunctions(source: string): readonly string[] {
	const file = ts.createSourceFile("action-node.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const oversized: string[] = [];
	const visit = (node: ts.Node): void => {
		const functionNode = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
		if (functionNode && node.body) {
			const start = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
			const end = file.getLineAndCharacterOfPosition(node.end).line;
			const name = "name" in node && node.name ? node.name.getText(file) : `callback:${start + 1}`;
			if (end - start + 1 > 50) oversized.push(`${name}:${end - start + 1}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return oversized;
}

describe("repeater coordinator", () => {
	it("fails closed for accessor and revoked structural payloads", () => {
		const getter = vi.fn(() => 0);
		const accessor = Object.defineProperty({}, "index", { enumerable: true, get: getter });
		const revocable = Proxy.revocable({ from: 0, to: 1 }, {});
		revocable.revoke();
		const coordinator = new RepeaterCoordinator();

		expect(coordinator.begin(state("array.insert", accessor), "insert")).toBeUndefined();
		expect(coordinator.begin(state("array.move", revocable.proxy), "move")).toBeUndefined();
		expect(getter).not.toHaveBeenCalled();
	});

	it("isolates duplicate bindings and removes every registration during unmount cleanup", () => {
		const coordinator = new RepeaterCoordinator();
		const target = bindingKey({ namespace: "data", segments: ["rows"] });
		const ownerA = { instanceKey: "A", bindingKey: target };
		const ownerB = { instanceKey: "B", bindingKey: target };
		const listenerA = listener();
		const listenerB = listener();
		const unregisterA = coordinator.register(ownerA, listenerA);
		const unregisterB = coordinator.register(ownerB, listenerB);
		const appendB = { disabled: false, isConnected: true } as HTMLButtonElement;
		const unregisterAppendB = coordinator.registerAppend(ownerB, appendB);

		const intent = coordinator.begin(state("array.remove", 0), "remove", ownerB);
		expect(intent).toBeDefined();
		expect(listenerA.apply).not.toHaveBeenCalled();
		expect(listenerB.apply).toHaveBeenCalledOnce();
		expect(coordinator.appendTarget(intent?.key as string)).toBe(appendB);
		coordinator.finish(intent, true);
		expect(listenerA.finish).not.toHaveBeenCalled();
		expect(listenerB.finish).toHaveBeenCalledOnce();

		unregisterAppendB();
		unregisterB();
		expect(coordinator.begin(state("array.remove", 0), "remove", ownerB)).toBeUndefined();
		expect(coordinator.appendTarget(intent?.key as string)).toBeUndefined();
		coordinator.reset();
		expect(listenerA.reset).toHaveBeenCalledOnce();
		expect(listenerB.reset).not.toHaveBeenCalled();
		unregisterA();
	});

	it("keeps every action-node function within the 50-line AST budget", () => {
		const source = readFileSync(fileURLToPath(new URL("../action-node.tsx", import.meta.url)), "utf8");
		expect(oversizedFunctions(source)).toEqual([]);
	});
});
