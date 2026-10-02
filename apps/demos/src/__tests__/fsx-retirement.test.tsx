// @vitest-environment jsdom
import type { KaladaV1Host } from "@formbar/declarative";
import { StrictMode, act, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FsxPreview } from "../fsx/FsxPreview";
import { fsxExamples } from "../fsx/registry";
import { useFsxSession } from "../fsx/use-fsx-session";

const allocations = vi.hoisted(() => [] as KaladaV1Host[]);
const stores = vi.hoisted(() => [] as { subscribers: Set<() => void> }[]);
const predecessorRevisions = vi.hoisted(() => [] as unknown[]);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("../runtime/kalada-demo-store", async (original) => {
	const module = await original<typeof import("../runtime/kalada-demo-store")>();
	return {
		...module,
		DemoStore: class extends module.DemoStore {
			constructor() {
				super();
				stores.push(this);
			}
		},
	};
});
vi.mock("../fsx/compile", async (original) => {
	const module = await original<typeof import("../fsx/compile")>();
	return {
		...module,
		installFsxDocument: (...args: Parameters<typeof module.installFsxDocument>) => {
			if (allocations.length) predecessorRevisions.push(allocations.at(-1)?.currentRevision());
			const host = module.installFsxDocument(...args);
			allocations.push(host);
			return host;
		},
	};
});

type View = {
	root: ReturnType<typeof createRoot>;
	container: HTMLDivElement;
	active: Set<KaladaV1Host>;
	current: () => ReturnType<typeof useFsxSession>;
};
const views: View[] = [];
afterEach(async () => {
	for (const view of views.splice(0)) {
		await act(async () => view.root.unmount());
		view.container.remove();
	}
	allocations.length = 0;
	stores.length = 0;
	predecessorRevisions.length = 0;
});

function mount(): View {
	let session: ReturnType<typeof useFsxSession>;
	const active = new Set<KaladaV1Host>();
	function Harness() {
		session = useFsxSession(fsxExamples[0]);
		const publish = session.onHost;
		const onHost = useCallback(
			(host: KaladaV1Host) => {
				active.add(host);
				const retire = publish(host);
				return () => {
					active.delete(host);
					retire();
				};
			},
			[publish],
		);
		return session.applied.result.ok ? (
			<FsxPreview
				key={session.applied.revision}
				document={session.applied.result.document}
				owner={session.owner}
				onHost={onHost}
			/>
		) : null;
	}
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() =>
		root.render(
			<StrictMode>
				<Harness />
			</StrictMode>,
		),
	);
	const view = { root, container, active, current: () => session };
	views.push(view);
	return view;
}

it("StrictMode allocates only one preview host and revokes every allocation on unmount", async () => {
	const view = mount();
	const writers = allocations.map(
		(host) => host.snapshot().controls.find((control) => control.nodeId === "quantity")?.writers.value,
	);
	await act(async () => view.root.unmount());
	expect(view.active.size).toBe(0);
	for (const write of writers) expect(write?.(99).status).not.toBe("applied");
	expect(allocations).toHaveLength(1);
	expect(stores.every((store) => store.subscribers.size === 0)).toBe(true);
});

const writer = (host: KaladaV1Host) =>
	host.snapshot().controls.find((control) => control.nodeId === "quantity")?.writers.value;
const listenerCount = () => stores.reduce((sum, store) => sum + store.subscribers.size, 0);

it("twenty StrictMode replacements retire listeners, writers and old DOM without losing the null draft", async () => {
	const view = mount();
	act(() => {
		expect(writer(allocations.at(-1) as KaladaV1Host)?.(null).status).toBe("applied");
	});
	const baseline = listenerCount();
	for (let iteration = 0; iteration < 20; iteration++) {
		const oldForm = view.container.querySelector("form");
		const previous = allocations.at(-1) as KaladaV1Host;
		const retained = writer(previous);
		act(() => view.current().setSource(fsxExamples[0].source.replace("Customer", `Client ${iteration}`)));
		await act(async () => view.current().apply());
		expect(allocations).toHaveLength(iteration + 2);
		expect(oldForm?.isConnected).toBe(false);
		expect(view.container.querySelectorAll("form")).toHaveLength(1);
		expect(view.active.size).toBe(1);
		expect(listenerCount()).toBe(baseline);
		expect(retained?.(99).status).not.toBe("applied");
		expect(allocations.at(-1)?.snapshot().data).toMatchObject({ quantity: null });
		await act(async () => {
			expect((await previous.submit()).status).not.toBe("submitted");
		});
	}
	await act(async () => view.root.unmount());
	expect(listenerCount()).toBe(0);
	console.log(
		JSON.stringify({
			previewAllocations: allocations.length,
			liveListenersPerPreview: baseline,
			listenersAfterUnmount: listenerCount(),
		}),
	);
	expect(predecessorRevisions).toHaveLength(20);
	expect(predecessorRevisions.every((revision) => revision === undefined)).toBe(true);
});

it("pending submit cancellation and rapid applies cannot publish into the replacement", async () => {
	const view = mount();
	const previous = allocations.at(-1) as KaladaV1Host;
	let pending: ReturnType<KaladaV1Host["submit"]>;
	act(() => view.current().setSource(fsxExamples[0].source.replace("Customer", "Client")));
	await act(async () => {
		pending = previous.submit();
		view.current().apply();
		view.current().apply();
		expect((await pending).status).not.toBe("submitted");
	});
	expect(view.container.querySelectorAll("form")).toHaveLength(1);
	expect(view.container.textContent).toContain("No successful submission yet");
	const next = allocations.at(-1) as KaladaV1Host;
	act(() => {
		expect(writer(next)?.(4).status).toBe("applied");
	});
	await act(async () => {
		expect((await next.submit()).status).toBe("submitted");
	});
	expect(view.container.textContent).toContain('"quantity": 4');
});
