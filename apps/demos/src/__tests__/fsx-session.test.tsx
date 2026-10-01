// @vitest-environment jsdom
import type { KaladaV1Host } from "@formbar/declarative";
import { StrictMode, act, useCallback } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { FsxPage } from "../fsx/FsxPage";
import { FsxPreview } from "../fsx/FsxPreview";
import { acceptFsxDocument, applyFsx, applyFsxFromHost, installFsxDocument, retireFsxDocument } from "../fsx/compile";
import { type FsxExample, fsxExamples } from "../fsx/registry";
import { useFsxSession } from "../fsx/use-fsx-session";
import { disposeDemoSession, installDemo } from "../runtime/kalada-demo-install";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const views: { root: ReturnType<typeof createRoot>; container: HTMLDivElement }[] = [];
afterEach(async () => {
	for (const { root, container } of views.splice(0)) {
		await act(async () => root.unmount());
		container.remove();
	}
	vi.restoreAllMocks();
});

function mount(example = fsxExamples[0]) {
	const hosts: KaladaV1Host[] = [];
	let session: ReturnType<typeof useFsxSession>;
	function Harness({ example }: { readonly example: FsxExample }) {
		session = useFsxSession(example);
		const publish = session.onHost;
		const onHost = useCallback(
			(host: KaladaV1Host) => {
				hosts.push(host);
				return publish(host);
			},
			[publish],
		);
		return session.applied.result.ok ? (
			<FsxPreview
				key={session.applied.revision}
				document={session.applied.result.document}
				onHost={onHost}
				owner={session.owner}
			/>
		) : null;
	}
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	views.push({ root, container });
	const render = (example: FsxExample) =>
		act(() =>
			root.render(
				<StrictMode>
					<Harness key={example.id} example={example} />
				</StrictMode>,
			),
		);
	render(example);
	return { hosts, current: () => session, render, root, container };
}
const writer = (host: KaladaV1Host, id = "quantity") =>
	host.snapshot().controls.find(({ nodeId }) => nodeId === id)?.writers.value;

it("SSR renders both real presets without installation errors", () => {
	for (const { id } of fsxExamples) {
		const html = renderToString(<FsxPage demoId={id} onSelect={() => {}} onClose={() => {}} />);
		expect(html).toContain("data-kalada-v1");
		expect(html).not.toContain('role="alert"');
	}
});

it("hydrates two FSX pages with stable unique IDs and no recoverable errors", async () => {
	const tree = (
		<StrictMode>
			<FsxPage demoId="quote" onSelect={() => {}} onClose={() => {}} />
			<FsxPage demoId="line-items" onSelect={() => {}} onClose={() => {}} />
		</StrictMode>
	);
	const container = document.createElement("div");
	container.innerHTML = renderToString(tree);
	document.body.append(container);
	const errors: unknown[] = [];
	const ids = () => [...container.querySelectorAll("[id]")].map(({ id }) => id);
	const before = ids();
	expect(new Set(before).size).toBe(before.length);
	await act(async () => {
		const root = hydrateRoot(container, tree, { onRecoverableError: (error) => errors.push(error) });
		views.push({ root, container });
	});
	expect(errors).toEqual([]);
	expect(ids()).toEqual(before);
});

it("failed drafts retain the applied preview, successful Apply revokes old writers and preserves data", async () => {
	const view = mount();
	const first = view.hosts.at(-1) as KaladaV1Host;
	act(() => {
		expect(writer(first)?.(6).status).toBe("applied");
	});
	act(() => view.current().setSource("<Form broken>"));
	act(() => view.current().apply());
	expect(view.current().diagnostics.length).toBeGreaterThan(0);
	expect(view.current().applied.revision).toBe(1);
	const retained = writer(first);
	act(() => {
		expect(retained?.(7).status).toBe("applied");
	});
	act(() => view.current().setSource(fsxExamples[0].source.replace("Customer", "Client")));
	expect(view.current().diagnostics).toEqual([]);
	const retired = writer(first);
	act(() => view.current().apply());
	expect(retired?.(99).status).not.toBe("applied");
	const next = view.hosts.at(-1) as KaladaV1Host;
	expect(next.snapshot().data).toMatchObject({ quantity: 7 });
	await act(async () => {
		expect((await first.submit()).status).not.toBe("submitted");
	});
});

it.each([
	{ id: "quantity", value: -1 },
	{ id: "name", value: "" },
])(
	"source-only Apply preserves validation-invalid $id and revokes old channels; edited JSON rejects it",
	async ({ id, value }) => {
		const view = mount();
		const first = view.hosts.at(-1) as KaladaV1Host;
		act(() => {
			expect(writer(first, id)?.(value).status).toBe("applied");
		});
		await act(async () => {
			await first.validate();
		});
		const before = first.snapshot();
		expect(before.lifecycle?.valid).toBe(false);
		const retired = writer(first, id);
		act(() => view.current().setSource("<Form broken>"));
		await act(async () => view.current().apply());
		expect(view.current().applied.revision).toBe(1);
		expect(first.snapshot().data).toEqual(before.data);
		act(() => view.current().setSource(fsxExamples[0].source.replace("Customer", "Client")));
		await act(async () => view.current().apply());
		expect(view.current().diagnostics).toEqual([]);
		expect(view.current().applied.revision).toBe(2);
		const next = view.hosts.at(-1) as KaladaV1Host;
		expect(next).not.toBe(first);
		expect(next.currentRevision()).not.toBe(before.revision);
		expect(next.snapshot().data).toEqual(before.data);
		expect(next.snapshot().lifecycle?.valid).toBe(false);
		expect(next.snapshot().lifecycle?.issues.schema).toEqual(before.lifecycle?.issues.schema);
		expect(retired?.(value).status).not.toBe("applied");
		await act(async () => {
			expect((await next.submit()).status).toBe("denied");
		});
		act(() => view.current().setData(JSON.stringify(before.data)));
		act(() => view.current().apply());
		expect(view.current().diagnostics[0]?.code).toBe("DEMO_INPUT_INVALID");
		expect(view.current().diagnostics[0]?.message).toContain("fixed demo schema");
		expect(view.current().applied.revision).toBe(2);
	},
);

it("data Apply/reset/preset change/unmount revoke callbacks and two instances never share drafts", async () => {
	const a = mount();
	const b = mount();
	const first = a.hosts.at(-1) as KaladaV1Host;
	const old = writer(first);
	act(() => a.current().setData(JSON.stringify({ name: "Grace", quantity: 3, unitPrice: 4 })));
	act(() => a.current().apply());
	expect(old?.(99).status).not.toBe("applied");
	const next = a.hosts.at(-1) as KaladaV1Host;
	expect(next.snapshot().data).toMatchObject({ quantity: 3 });
	expect(b.hosts.at(-1)?.snapshot().data).toMatchObject({ quantity: 2 });
	const beforeReset = writer(next);
	act(() => a.current().reset());
	expect(beforeReset?.(99).status).not.toBe("applied");
	const beforeSwitch = writer(a.hosts.at(-1) as KaladaV1Host);
	await act(async () => a.render(fsxExamples[1]));
	expect(beforeSwitch?.(99).status).not.toBe("applied");
	const finalHost = a.hosts.at(-1) as KaladaV1Host;
	const beforeUnmount = writer(finalHost, "tag");
	await act(async () => a.root.unmount());
	expect(beforeUnmount?.("retired").status).not.toBe("applied");
});

it.each([
	{ example: 0, id: "quantity" },
	{ example: 0, id: "unit-price" },
	{ example: 1, id: "amount" },
])("blank $id survives source-only Apply all the way through installation, then recovers", async ({ example, id }) => {
	const preset = fsxExamples[example];
	const view = mount(preset);
	const first = view.hosts.at(-1) as KaladaV1Host;
	act(() => {
		expect(writer(first, id)?.(null).status).toBe("applied");
	});
	await act(async () => {
		expect((await first.submit()).status).toBe("denied");
	});
	const before = first.snapshot();
	const retired = writer(first, id);
	act(() => view.current().setSource(preset.source.replace("label=", "label= ")));
	await act(async () => view.current().apply());
	expect(view.current().diagnostics).toEqual([]);
	expect(view.current().applied.revision).toBe(2);
	const next = view.hosts.at(-1) as KaladaV1Host;
	expect(next.snapshot().data).toEqual(before.data);
	expect(next.snapshot().lifecycle?.valid).toBe(false);
	expect(retired?.(10).status).not.toBe("applied");
	await act(async () => {
		expect((await next.submit()).status).toBe("denied");
	});
	act(() => view.current().setData(JSON.stringify(before.data)));
	act(() => view.current().apply());
	expect(view.current().diagnostics[0]?.code).toBe("DEMO_INPUT_INVALID");
	act(() => {
		expect(writer(next, id)?.(10).status).toBe("applied");
	});
	await act(async () => {
		expect((await next.submit()).status).toBe("submitted");
	});
});

it("a failing computed preview stays contained and source correction preserves the actual null draft", async () => {
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	const view = mount();
	act(() =>
		view
			.current()
			.setSource(fsxExamples[0].source.replace('quantity == null || unitPrice == null ? "Enter both numbers" : ', "")),
	);
	await act(async () => view.current().apply());
	const broken = view.hosts.at(-1) as KaladaV1Host;
	await act(async () => {
		expect(writer(broken)?.(null).status).toBe("applied");
	});
	expect(view.container.textContent).toContain("Preview failed");
	expect(view.container.textContent).toContain("KALADA_OPERATOR_TYPE");
	act(() => view.current().setSource(fsxExamples[0].source));
	await act(async () => view.current().apply());
	expect(view.current().diagnostics).toEqual([]);
	expect(view.hosts.at(-1)?.snapshot().data).toMatchObject({ quantity: null });
	expect(view.container.textContent).toContain("Enter both numbers");
	errors.mockRestore();
});

it("accepted null destination supports same-owner SSR/StrictMode hydration, then revokes lifecycle replay", async () => {
	const quote = fsxExamples[0];
	const initial = applyFsx(quote, quote.source, JSON.stringify(quote.data));
	if (!initial.ok) throw new Error("Initial apply failed");
	const source = installDemo(initial.document);
	expect(writer(source)?.(null).status).toBe("applied");
	const retained = applyFsxFromHost(quote, quote.source.replace("Customer", "Client"), source);
	if (!retained.ok) throw new Error("Retained preflight failed");
	const owner = Object.freeze({});
	acceptFsxDocument(retained.document, owner);
	disposeDemoSession(source);
	const hosts: KaladaV1Host[] = [];
	const tree = (
		<StrictMode>
			<FsxPreview
				document={retained.document}
				owner={owner}
				onHost={(host) => {
					hosts.push(host);
					return () => {};
				}}
			/>
		</StrictMode>
	);
	const container = document.createElement("div");
	container.innerHTML = renderToString(tree);
	document.body.append(container);
	const errors: unknown[] = [];
	await act(async () => {
		views.push({
			root: hydrateRoot(container, tree, { onRecoverableError: (error) => errors.push(error) }),
			container,
		});
	});
	expect(errors).toEqual([]);
	expect(hosts.at(-1)?.snapshot().data).toMatchObject({ quantity: null });
	expect(() => installFsxDocument(retained.document, undefined, {})).toThrow("foreign");
	const mounted = hosts.at(-1);
	if (!mounted) throw new Error("Missing hydrated host");
	const retired = writer(mounted);
	const view = views.at(-1);
	if (!view) throw new Error("Missing hydrated view");
	await act(async () => {
		view.root.unmount();
		retireFsxDocument(retained.document, owner);
	});
	expect(retired?.(8).status).not.toBe("applied");
	expect(() => installFsxDocument(retained.document, undefined, owner)).toThrow("retired");
});

it("session source replacement and unmount revoke the actual destination lifecycle grant", async () => {
	const view = mount();
	const first = view.hosts.at(-1);
	if (!first) throw new Error("Missing source host");
	act(() => {
		expect(writer(first)?.(null).status).toBe("applied");
	});
	act(() => view.current().setSource(fsxExamples[0].source.replace("Customer", "Client")));
	await act(async () => view.current().apply());
	const applied = view.current().applied.result;
	if (!applied.ok) throw new Error("First retained apply failed");
	const owner = view.current().owner;
	act(() => view.current().setSource(view.current().source.replace("Client", "Buyer")));
	await act(async () => view.current().apply());
	expect(() => installFsxDocument(applied.document, undefined, owner)).toThrow("retired");
	const latest = view.current().applied.result;
	if (!latest.ok) throw new Error("Second retained apply failed");
	await act(async () => view.root.unmount());
	expect(() => installFsxDocument(latest.document, undefined, owner)).toThrow("retired");
});
