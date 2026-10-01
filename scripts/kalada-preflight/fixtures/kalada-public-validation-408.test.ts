import { expect, it } from "vitest";
import { hostSchema, validationHost } from "./kalada-validation-host-408.js";

it("authored omission is admitted, validates outgoing bytes, retains the draft and submits once", async () => {
	const h = validationHost(hostSchema, { omission: "omit-inactive" });
	const result = await h.host.submit();
	expect(result.status).toBe("submitted");
	const state = [...h.installed.instances.values()][0];
	expect(state?.outgoing).toMatchObject({ profile: {} });
	expect(h.host.snapshot().data).toMatchObject({ profile: { name: "original" } });
});

it("trusted scoped change after write and blur use lexical rows and do not mutate the draft", async () => {
	const called: string[] = [];
	const h = validationHost(hostSchema, {
		scopedValidators: [
			{
				id: "name",
				field: "root.children[0].children[0]",
				trigger: "onBlur",
				validate: () => {
					called.push("blur");
					return [];
				},
			},
			{
				id: "quantity",
				field: "root.children[1].children[0].children[0].children[0].children[0]",
				trigger: "onChange",
				validate: () => {
					called.push("change");
					return [];
				},
			},
		],
	});
	const snapshot = h.host.snapshot();
	const name = snapshot.controls.find((control) => control.nodeId === h.nameId);
	const quantity = snapshot.controls.find((control) => control.nodeId === h.quantityId);
	expect(name?.onBlur?.().status).toBe("applied");
	expect(h.host.snapshot().data).toEqual(snapshot.data);
	expect(called).toEqual(["blur"]);
	expect(quantity?.writers.value?.("changed").status).toBe("applied");
	expect(called).toEqual(["blur", "change"]);
	expect(name?.onBlur?.().status).toBe("stale");
	expect(h.host.snapshot().data).not.toEqual(snapshot.data);
	h.host.dispose();
});

it("fences a pending scoped validator after reset or disposal", async () => {
	for (const dispose of [false, true]) {
		let release = (_issues: readonly { path: readonly string[]; message: string; source: "extension" }[]) => {};
		const pending = new Promise<readonly { path: readonly string[]; message: string; source: "extension" }[]>(
			(resolve) => {
				release = resolve;
			},
		);
		const h = validationHost(hostSchema, {
			scopedValidators: [
				{
					id: "pending",
					field: "root.children[0].children[0]",
					trigger: "onBlur",
					validate: () => pending,
				},
			],
		});
		expect(
			h.host
				.snapshot()
				.controls.find((control) => control.nodeId === h.nameId)
				?.onBlur?.().status,
		).toBe("applied");
		expect(await h.host.submit()).toEqual({ status: "denied" });
		if (dispose) h.host.dispose();
		else expect(h.host.reset().ok).toBe(true);
		release([{ path: ["profile", "name"], message: "late", source: "extension" }]);
		await pending;
		await Promise.resolve();
		expect([...h.installed.instances.values()][0]?.scopedIssues.size).toBe(0);
		if (!dispose) h.host.dispose();
	}
});

it("rejects authored/generated conflicts and missing scoped host capability", () => {
	const h = validationHost();
	expect(() =>
		validationHost(hostSchema, {
			scopedValidators: [{ id: "x", field: "missing", trigger: "onBlur", validate: () => [] }],
		}),
	).toThrow();
	expect(h.host.reset().ok).toBe(true);
});
