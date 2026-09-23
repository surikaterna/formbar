// @vitest-environment jsdom
import type { FormApi, FormPlugin, FormState } from "@formbar/core";
import { StrictMode, act } from "react";
import type { ReactNode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import * as server from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useForm } from "../index.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Data {
	name: string;
	nested: { count: number };
}

interface UiState {
	theme: string;
}

interface Lifecycle {
	readonly forms: Set<FormApi<Data, UiState>>;
	readonly snapshots: Map<FormApi<Data, UiState>, readonly FormState<Data, UiState>[]>;
	readonly subscribedForms: Set<FormApi<Data, UiState>>;
	readonly disposeCalls: Map<FormApi<Data, UiState>, number>;
	active: number;
	maxActive: number;
	subscriptions: number;
	unsubscriptions: number;
	actionCalls: number;
	pluginEvaluations: number;
}

interface PluginSessions {
	active: number;
	maxActive: number;
	created: number;
	disposed: number;
}

function createLifecycle(): Lifecycle {
	return {
		forms: new Set(),
		snapshots: new Map(),
		subscribedForms: new Set(),
		disposeCalls: new Map(),
		active: 0,
		maxActive: 0,
		subscriptions: 0,
		unsubscriptions: 0,
		actionCalls: 0,
		pluginEvaluations: 0,
	};
}

function observeLifecycle(form: FormApi<Data, UiState>, lifecycle: Lifecycle): void {
	if (lifecycle.forms.has(form)) return;
	lifecycle.forms.add(form);
	const subscribe = form.subscribe;
	form.subscribe = (listener) => {
		const unsubscribe = subscribe(listener);
		let active = true;
		lifecycle.subscribedForms.add(form);
		lifecycle.subscriptions += 1;
		lifecycle.active += 1;
		lifecycle.maxActive = Math.max(lifecycle.maxActive, lifecycle.active);
		return () => {
			if (!active) return;
			active = false;
			lifecycle.unsubscriptions += 1;
			lifecycle.active -= 1;
			unsubscribe();
		};
	};
	const dispose = form.dispose;
	form.dispose = () => {
		if (!form.isDisposed()) lifecycle.disposeCalls.set(form, (lifecycle.disposeCalls.get(form) ?? 0) + 1);
		dispose();
	};
}

function startPluginSession(sessions: PluginSessions): () => void {
	sessions.active += 1;
	sessions.created += 1;
	sessions.maxActive = Math.max(sessions.maxActive, sessions.active);
	return () => {
		sessions.active -= 1;
		sessions.disposed += 1;
	};
}

function Snapshot(props: { readonly lifecycle: Lifecycle; readonly sessions?: PluginSessions }) {
	const plugin: FormPlugin<Data, UiState> = {
		id: "ssr-evidence",
		evaluate: () => {
			props.lifecycle.pluginEvaluations += 1;
		},
		...(props.sessions ? { onInit: () => startPluginSession(props.sessions as PluginSessions) } : {}),
	};
	const initialData = { name: "Ada", nested: { count: 2 } };
	const initialUiState = { theme: "night" };
	const form = useForm<Data, UiState>({
		initialData,
		initialUiState,
		plugins: [plugin],
		autoFocusOnError: false,
		onSubmit: async () => {
			props.lifecycle.actionCalls += 1;
			return { ok: true, submitId: "unexpected" };
		},
	});
	observeLifecycle(form, props.lifecycle);
	const first = form.getState();
	const second = form.getState();
	if (!props.lifecycle.snapshots.has(form)) props.lifecycle.snapshots.set(form, [first, second]);
	return (
		<output
			data-name={first.data.name}
			data-theme={first.uiState.theme}
			data-issues={first.issues.length}
			data-status={first.meta.submission?.status ?? "idle"}
			data-validating={String(first.meta.validation.validating === true)}
			data-submitted={String(first.meta.submitted === true)}
			data-pristine={String(form.isPristine())}
			data-dirty={String(form.isDirty())}
			data-cloned={String(first.data !== initialData && first.uiState !== initialUiState)}
			data-same-snapshot={String(first === second)}
		>
			{first.data.name}:{first.uiState.theme}
		</output>
	);
}

async function readableStreamHtml(element: ReactNode): Promise<string | undefined> {
	if (!("renderToReadableStream" in server)) return undefined;
	const stream = await server.renderToReadableStream(element);
	return new Response(stream).text();
}

async function flushDisposalTimers(): Promise<void> {
	await act(async () => {
		await vi.runAllTimersAsync();
		await Promise.resolve();
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe("useForm SSR snapshots", () => {
	it("renders authoritative stable initial state to strings and streams without subscribing or running actions", async () => {
		const lifecycle = createLifecycle();
		const firstHtml = server.renderToString(<Snapshot lifecycle={lifecycle} />);
		const secondHtml = server.renderToString(<Snapshot lifecycle={lifecycle} />);
		const streamedHtml = await readableStreamHtml(<Snapshot lifecycle={lifecycle} />);

		expect(secondHtml).toBe(firstHtml);
		if (streamedHtml !== undefined) expect(streamedHtml).toBe(firstHtml);
		expect(firstHtml).toContain('data-name="Ada"');
		expect(firstHtml).toContain('data-theme="night"');
		expect(firstHtml).toContain('data-issues="0"');
		expect(firstHtml).toContain('data-status="idle"');
		expect(firstHtml).toContain('data-validating="false"');
		expect(firstHtml).toContain('data-submitted="false"');
		expect(firstHtml).toContain('data-pristine="true"');
		expect(firstHtml).toContain('data-dirty="false"');
		expect(firstHtml).toContain('data-cloned="true"');
		expect(firstHtml).toContain('data-same-snapshot="true"');
		expect(lifecycle.active).toBe(0);
		expect(lifecycle.subscriptions).toBe(0);
		expect(lifecycle.actionCalls).toBe(0);
		expect(lifecycle.pluginEvaluations).toBe(0);

		const forms = [...lifecycle.forms];
		expect(forms).toHaveLength(streamedHtml === undefined ? 2 : 3);
		const states = forms.map((form) => lifecycle.snapshots.get(form)?.[0]);
		expect(new Set(states).size).toBe(states.length);
		for (const form of forms) {
			const snapshots = lifecycle.snapshots.get(form);
			expect(snapshots?.[0]).toBe(snapshots?.[1]);
			expect(snapshots?.[0]).toMatchObject({
				data: { name: "Ada", nested: { count: 2 } },
				uiState: { theme: "night" },
				meta: { validation: { validating: false } },
				fieldMeta: {},
				fieldPolicy: [],
				issues: [],
			});
			expect(snapshots?.[0]?.meta.submission).toBeUndefined();
			expect(snapshots?.[0]?.meta.submitted).toBeUndefined();
			expect(form.isTouched()).toBe(false);
			expect(form.isSubmitting()).toBe(false);
			form.dispose();
		}
	});

	it("hydrates without diagnostics, subscribes after commit, and renders later transitions", async () => {
		vi.useFakeTimers();
		const serverLifecycle = createLifecycle();
		const html = server.renderToString(<Snapshot lifecycle={serverLifecycle} />);
		for (const form of serverLifecycle.forms) form.dispose();
		const clientLifecycle = createLifecycle();
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const recoverable: unknown[] = [];
		let root: ReturnType<typeof hydrateRoot>;
		await act(async () => {
			root = hydrateRoot(container, <Snapshot lifecycle={clientLifecycle} />, {
				onRecoverableError: (error) => recoverable.push(error),
			});
			await Promise.resolve();
		});
		const [form] = [...clientLifecycle.subscribedForms];
		const initial = form.getState();
		expect(clientLifecycle.active).toBe(1);
		expect(clientLifecycle.maxActive).toBe(1);
		expect(consoleError).not.toHaveBeenCalled();
		expect(recoverable).toEqual([]);

		act(() => form.setValue("name", "Grace"));
		expect(form.getState()).not.toBe(initial);
		expect(container.querySelector("output")?.textContent).toBe("Grace:night");
		expect(clientLifecycle.actionCalls).toBe(0);
		act(() => root.unmount());
		expect(clientLifecycle.active).toBe(0);
		expect(clientLifecycle.unsubscriptions).toBe(clientLifecycle.subscriptions);
		await flushDisposalTimers();
		expect(clientLifecycle.disposeCalls.get(form)).toBe(1);
		expect(form.isDisposed()).toBe(true);
	});

	it("keeps StrictMode subscriptions singular and committed cleanup balanced", async () => {
		vi.useFakeTimers();
		const lifecycle = createLifecycle();
		const sessions: PluginSessions = { active: 0, maxActive: 0, created: 0, disposed: 0 };
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		act(() =>
			root.render(
				<StrictMode>
					<Snapshot lifecycle={lifecycle} sessions={sessions} />
				</StrictMode>,
			),
		);
		expect(lifecycle.active).toBe(1);
		expect(lifecycle.maxActive).toBe(1);
		expect(lifecycle.subscribedForms.size).toBe(1);
		expect(sessions.active).toBe(1);
		expect(sessions.maxActive).toBe(1);
		for (const form of lifecycle.forms) {
			if (!lifecycle.subscribedForms.has(form)) expect(lifecycle.snapshots.has(form)).toBe(true);
		}

		act(() => root.unmount());
		expect(lifecycle.active).toBe(0);
		expect(lifecycle.unsubscriptions).toBe(lifecycle.subscriptions);
		await flushDisposalTimers();
		for (const form of lifecycle.subscribedForms) {
			expect(lifecycle.disposeCalls.get(form)).toBe(1);
			expect(form.isDisposed()).toBe(true);
		}
		expect(sessions.active).toBe(0);
		expect(sessions.disposed).toBe(sessions.created);
	});
});
