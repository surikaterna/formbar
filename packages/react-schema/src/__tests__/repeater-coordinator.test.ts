import type { ResolvedActionState } from "@formbar/declarative";
import { describe, expect, it, vi } from "vitest";
import { RepeaterCoordinator } from "../repeater-coordinator.js";

function state(action: ResolvedActionState["action"], value: unknown): ResolvedActionState {
	return {
		type: "action",
		action,
		payload: { status: "ready", value },
		target: { namespace: "data", segments: ["rows"] },
		instance: { nodeId: "action", instanceKey: "action", scopes: [{ scope: "row", index: 0 }] },
	} as ResolvedActionState;
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
});
