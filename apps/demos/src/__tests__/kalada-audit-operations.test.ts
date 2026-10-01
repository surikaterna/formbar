import type { FormDefinition } from "@formbar/declarative";
import { expect, it, vi } from "vitest";
import { dataRef } from "../demos/kalada-fixture-programs";
import type { PlaygroundDocument } from "../playground/contracts";
import { disposeDemoSession, installDemo } from "../runtime/kalada-demo-install";
import type { Issue } from "../runtime/kalada-demo-store";
import { deferred, omissionDocument } from "./kalada-audit-fixtures";

function submittedHost(
	concurrency: "replace" | "drop" | "queue",
	check: Parameters<typeof installDemo>[5],
	submitted = vi.fn(),
	omit = false,
) {
	const source = omit
		? omissionDocument()
		: ({
				version: 2 as const,
				schema: { type: "object", properties: { name: { type: "string" } } },
				initialData: { name: "valid" },
				definition: {
					version: 1,
					id: "submit",
					root: {
						type: "group",
						id: "root",
						children: [
							{ type: "field", id: "name", widget: "text", binding: { namespace: "data", segments: ["name"] } },
						],
					},
				},
			} satisfies PlaygroundDocument);
	const definition: FormDefinition = {
		...source.definition,
		root: {
			...source.definition.root,
			children: [...source.definition.root.children, { type: "action", id: "submit", action: "submit", concurrency }],
		},
	};
	return installDemo({ ...source, definition }, submitted, ["formbar.standard.v1"], {}, undefined, check);
}
const submitAction = (host: ReturnType<typeof installDemo>) =>
	host.snapshot().tree.children?.find((node) => node.nodeId === "submit")?.action;

it.each([false, true])(
	"R8 public replace cancels the first deferred %s submission and commits only the latest",
	async (omit) => {
		const first = deferred<readonly Issue[]>();
		const second = deferred<readonly Issue[]>();
		const submitted = vi.fn();
		const signals: AbortSignal[] = [];
		const check = (data: unknown, signal: AbortSignal) => {
			if (omit && data && typeof data === "object" && Object.hasOwn(data, "hidden")) return [];
			signals.push(signal);
			return signals.length === 1 ? first.promise : second.promise;
		};
		const host = submittedHost("replace", { validators: [check] }, submitted, omit);
		try {
			const old = submitAction(host)?.invoke();
			for (let i = 0; i < 30 && !signals.length; i++) await Promise.resolve();
			const latest = submitAction(host)?.invoke();
			for (let i = 0; i < 30 && signals.length < 2; i++) await Promise.resolve();
			expect(signals).toHaveLength(2);
			expect(signals[0].aborted).toBe(true);
			first.settle([]);
			expect((await old)?.status).not.toBe("submitted");
			second.settle([]);
			expect((await latest)?.status).toBe("submitted");
			expect(submitted).toHaveBeenCalledTimes(1);
		} finally {
			disposeDemoSession(host);
		}
	},
);

it.each(["drop", "queue"] as const)("R8 %s never duplicates a submission from a retired frame", async (concurrency) => {
	const validation = deferred<readonly Issue[]>();
	const submitted = vi.fn();
	const host = submittedHost(concurrency, { validators: [() => validation.promise] }, submitted);
	try {
		const action = submitAction(host);
		const first = action?.invoke();
		const second = action?.invoke();
		validation.settle([]);
		expect((await first)?.status).toBe("submitted");
		expect((await second)?.status).toBe(concurrency === "drop" ? "dropped" : "stale");
		expect(submitted).toHaveBeenCalledTimes(1);
	} finally {
		disposeDemoSession(host);
	}
});

it("R8 disposing a public deferred operation aborts its validation and cannot commit", async () => {
	const validation = deferred<readonly Issue[]>();
	const submitted = vi.fn();
	let signal: AbortSignal | undefined;
	const host = submittedHost(
		"replace",
		{
			validators: [
				(_data, owned) => {
					signal = owned;
					return validation.promise;
				},
			],
		},
		submitted,
	);
	const pending = submitAction(host)?.invoke();
	disposeDemoSession(host);
	expect(signal?.aborted).toBe(true);
	validation.settle([]);
	expect((await pending)?.status).not.toBe("submitted");
	expect(submitted).not.toHaveBeenCalled();
});

it("R7 an actual snapshot→blur→snapshot retains the manager but refreshes its canonical array payload", async () => {
	const host = installDemo({
		version: 2,
		schema: {
			type: "object",
			properties: { seed: { type: "string" }, rows: { type: "array", items: { type: "string" } } },
		},
		initialData: { seed: "fresh", rows: [] },
		definition: {
			version: 1,
			id: "payload",
			root: {
				type: "group",
				id: "root",
				children: [
					{ type: "field", id: "seed", widget: "text", binding: { namespace: "data", segments: ["seed"] } },
					{
						type: "repeater",
						id: "rows",
						scope: "line",
						binding: { namespace: "data", segments: ["rows"] },
						children: [
							{
								type: "field",
								id: "value",
								widget: "text",
								binding: { namespace: "data", segments: [], scope: "line" },
							},
						],
					},
					{
						type: "action",
						id: "append",
						action: "array.append",
						target: { namespace: "data", segments: ["rows"] },
						payload: dataRef("seed"),
					},
				],
			},
		},
	});
	let notifications = 0;
	const unsubscribe = host.subscribe(() => {
		notifications++;
		host.snapshot();
	});
	try {
		const first = host.snapshot();
		const revision = host.currentRevision();
		const action = first.tree.children?.find((node) => node.nodeId === "append")?.action;
		expect(first.controls[0].onBlur?.().status).toBe("applied");
		const observed = host.snapshot();
		expect(host.currentRevision()).toBe(revision);
		expect(observed.tree.children?.find((node) => node.nodeId === "append")?.action).toBe(action);
		expect((await action?.invoke())?.status).toBe("applied");
		expect(host.snapshot().data).toEqual({ seed: "fresh", rows: ["fresh"] });
		expect(notifications).toBe(2);
		expect((await action?.invoke())?.status).toBe("stale");
	} finally {
		unsubscribe();
		disposeDemoSession(host);
	}
});
