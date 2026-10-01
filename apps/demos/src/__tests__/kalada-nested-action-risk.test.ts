import type { KaladaV1Host } from "@formbar/declarative";
import { expect, it } from "vitest";
import { literal } from "../demos/kalada-fixture-programs";
import { disposeDemoSession, installDemo } from "../runtime/kalada-demo-install";

const outerTarget = { namespace: "data", segments: ["groups"] };
const innerTarget = { namespace: "data", segments: ["values"], scope: "group" };
const schema = {
	type: "object",
	additionalProperties: false,
	properties: {
		groups: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: { values: { type: "array", items: { type: "string" } } },
			},
		},
	},
};
const definition = {
	version: 1,
	id: "nested-risk",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "repeater",
				id: "groups",
				scope: "group",
				binding: outerTarget,
				children: [
					{
						type: "repeater",
						id: "values",
						scope: "value",
						binding: innerTarget,
						children: [
							{
								type: "field",
								id: "value",
								widget: "text",
								binding: { namespace: "data", segments: [], scope: "value" },
							},
							{ type: "action", id: "remove-value", action: "array.remove", target: innerTarget },
						],
					},
					{ type: "action", id: "move-group", action: "array.move", target: outerTarget, payload: literal({}) },
				],
			},
		],
	},
};
const initialData = { groups: [{ values: ["first", "second"] }, { values: ["other"] }] };

function groupMove(view: ReturnType<KaladaV1Host["snapshot"]>) {
	const root = view.tree.children?.[0];
	const action = root?.rows?.[1].children.find((node) => node.nodeId === "move-group")?.action;
	const destination = view.rows.find((row) => row.path === "root.children[0]" && row.order === 0)?.key;
	if (!action || !destination) throw new Error("Missing nested move authority");
	return () => action.invoke(destination);
}

function removeValue(view: ReturnType<KaladaV1Host["snapshot"]>) {
	const nested = view.tree.children?.[0].rows?.[1].children[0].rows?.[0];
	const action = nested?.children.find((node) => node.nodeId === "remove-value")?.action;
	if (!action) throw new Error("Missing nested remove authority");
	return () => action.invoke();
}

it("keeps nested primitive identity through outer reorder and fences removal/reset replacement callbacks", async () => {
	const host = installDemo({ version: 2, schema, definition, initialData });
	try {
		const before = host.snapshot();
		expect(before.controls.find((control) => control.value === "first")?.writers.value?.("first-edited").status).toBe(
			"applied",
		);
		const edited = host.snapshot();
		expect(edited.controls.find((control) => control.value === "first-edited")?.lifecycle).toMatchObject({
			dirty: true,
			touched: true,
		});
		const old = edited.controls.find((control) => control.value === "first-edited")?.writers.value;
		expect((await groupMove(edited)()).status).toBe("applied");
		const moved = host.snapshot();
		expect(old?.("stale").status).not.toBe("applied");
		expect(moved.controls.find((control) => control.value === "first-edited")?.key).toBe(
			before.controls.find((control) => control.value === "first")?.key,
		);
		expect(moved.controls.find((control) => control.value === "first-edited")?.lifecycle).toMatchObject({
			dirty: true,
			touched: true,
		});
		expect(moved.controls.find((control) => control.value === "other")?.lifecycle).toMatchObject({
			dirty: false,
			touched: false,
		});
		const writer = moved.controls.find((control) => control.value === "first-edited")?.writers.value;
		expect(writer?.("edited").status).toBe("applied");
		expect(host.snapshot().data).toEqual({ groups: [{ values: ["other"] }, { values: ["edited", "second"] }] });
		const current = host.snapshot();
		const removed = current.controls.find((control) => control.value === "edited")?.writers.value;
		expect((await removeValue(current)()).status).toBe("applied");
		const draft = host.snapshot().data;
		const revision = host.currentRevision();
		expect(removed?.("removed").status).not.toBe("applied");
		expect(host.currentRevision()).toBe(revision);
		expect(host.snapshot().data).toEqual(draft);
		const replaced = host.snapshot().controls.find((control) => control.value === "second")?.writers.value;
		expect(host.reset().ok).toBe(true);
		expect(replaced?.("replacement").status).not.toBe("applied");
		expect(host.snapshot().data).toEqual(initialData);
		expect(host.snapshot().controls.every((control) => !control.lifecycle?.dirty && !control.lifecycle?.touched)).toBe(
			true,
		);
	} finally {
		disposeDemoSession(host);
	}
});
