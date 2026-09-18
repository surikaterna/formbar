import { PassThrough } from "node:stream";
import { type FormApi, createForm } from "@formbar/core";
import type { SchemaFormResult } from "@formbar/from-schema";
import { describe, expect, it, vi } from "vitest";
import { createStandaloneInteraction } from "../standalone-interaction.js";
import { normalizeStandaloneInput, renderStandaloneForm } from "../standalone.js";

const schema: SchemaFormResult = {
	fields: [{ path: "name", type: "string", required: true, metadata: { title: "Name" } }],
	layout: { type: "section", id: "root", children: [{ type: "field", id: "name", path: "name" }] },
	metadata: {},
	validators: [],
	defaults: { name: "Ada" },
	optionsByPath: new Map(),
	warnings: [],
};

const CI_RENDER_TIMEOUT = 30_000;

describe("standalone input normalization", () => {
	it("normalizes controls, modifiers, deletion, Unicode paste, and Space fallback deterministically", () => {
		expect(normalizeStandaloneInput("c", { ctrl: true })).toEqual({ kind: "exit", reason: "ctrl-c" });
		expect(normalizeStandaloneInput("S", { ctrl: true })).toEqual({ kind: "action", input: "form-submit" });
		expect(normalizeStandaloneInput("\x7f", { delete: true })).toEqual({ kind: "action", input: "backspace" });
		expect(normalizeStandaloneInput("", { delete: true })).toEqual({ kind: "action", input: "delete-forward" });
		expect(normalizeStandaloneInput("", { leftArrow: true })).toEqual({ kind: "action", input: "arrow-left" });
		expect(normalizeStandaloneInput("", { escape: true, meta: true })).toEqual({ kind: "action", input: "escape" });
		expect(normalizeStandaloneInput(" ")).toEqual({ kind: "action", input: "space", textFallback: " " });
		expect(normalizeStandaloneInput("é👩‍💻paste")).toEqual({ kind: "text", text: "é👩‍💻paste" });
		expect(normalizeStandaloneInput("a\nb")).toBeUndefined();
		expect(normalizeStandaloneInput("x", { meta: true })).toBeUndefined();
		expect(normalizeStandaloneInput("", { tab: true, return: true })).toBeUndefined();
	});
});

describe("standalone host lifecycle", () => {
	it("rejects non-TTY and disposed forms synchronously without mutating raw mode", () => {
		const form = makeForm();
		const streams = fakeStreams();
		streams.stdin.isTTY = false;
		expect(() => renderStandaloneForm({ form, schema, ...streams })).toThrow(/interactive TTY/);
		expect(streams.raw).not.toHaveBeenCalled();
		form.dispose();
		expect(() => renderStandaloneForm({ form, schema, ...fakeStreams() })).toThrow(/disposed form/);
	});

	it("rolls back a partial startup without taking host ownership", async () => {
		const streams = fakeStreams();
		const form = makeForm();
		streams.raw.mockImplementation(() => {
			throw new Error("raw startup");
		});
		expect(() => renderStandaloneForm({ form, schema, ...streams, formOwnership: "host" })).toThrow("raw startup");
		expect(form.isDisposed()).toBe(false);
		streams.raw.mockImplementation(() => streams.stdin);
		const retry = renderStandaloneForm({ form, schema, ...streams });
		retry.unmount();
		await retry.waitUntilExit();
		form.dispose();
	});

	it("leases either stream exclusively while allowing distinct stream pairs", async () => {
		const first = fakeStreams();
		const second = fakeStreams();
		const a = renderStandaloneForm({ form: makeForm(), schema, ...first });
		expect(() =>
			renderStandaloneForm({
				form: makeForm(),
				schema,
				stdin: first.stdin,
				stdout: second.stdout,
				stderr: second.stderr,
			}),
		).toThrow(/leased/);
		expect(() =>
			renderStandaloneForm({
				form: makeForm(),
				schema,
				stdin: second.stdin,
				stdout: first.stdout,
				stderr: second.stderr,
			}),
		).toThrow(/leased/);
		const b = renderStandaloneForm({ form: makeForm(), schema, ...second });
		a.unmount();
		b.unmount();
		await Promise.all([a.waitUntilExit(), b.waitUntilExit()]);
	});

	it(
		"shares one exit promise, restores raw mode, and leaves caller-owned forms alive",
		async () => {
			const streams = fakeStreams();
			const form = makeForm();
			const instance = renderStandaloneForm({ form, schema, ...streams });
			const promise = instance.waitUntilExit();
			expect(instance.waitUntilExit()).toBe(promise);
			await vi.waitFor(() => expect(streams.output()).toContain("Actions:"), { timeout: CI_RENDER_TIMEOUT });
			instance.unmount();
			instance.unmount();
			expect(await promise).toEqual({ reason: "unmount" });
			expect(streams.raw).toHaveBeenLastCalledWith(false);
			expect(form.isDisposed()).toBe(false);
			form.dispose();
		},
		CI_RENDER_TIMEOUT + 5_000,
	);

	it("opts into signals without re-signaling and disposes a host-owned form last", async () => {
		const before = process.listenerCount("SIGTERM");
		const streams = fakeStreams();
		const form = makeForm();
		const instance = renderStandaloneForm({ form, schema, ...streams, formOwnership: "host", signals: ["SIGTERM"] });
		expect(process.listenerCount("SIGTERM")).toBe(before + 1);
		process.emit("SIGTERM");
		expect(await instance.waitUntilExit()).toEqual({ reason: "signal", signal: "SIGTERM" });
		expect(process.listenerCount("SIGTERM")).toBe(before);
		expect(form.isDisposed()).toBe(true);
		expect(streams.raw).toHaveBeenLastCalledWith(false);
	});

	it("does not auto-exit for an external submit", async () => {
		const form = makeForm();
		const instance = renderStandaloneForm({ form, schema, ...fakeStreams() });
		await form.submit();
		let settled = false;
		void instance.waitUntilExit().then(() => {
			settled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(settled).toBe(false);
		instance.unmount();
		await instance.waitUntilExit();
		form.dispose();
	});

	it(
		"runs the success callback before default exit even when the callback throws",
		async () => {
			const streams = fakeStreams();
			const form = makeForm();
			const events: string[] = [];
			const instance = renderStandaloneForm({
				form,
				schema,
				...streams,
				onSubmitSuccess: () => {
					events.push("callback");
					throw new Error("consumer callback");
				},
			});
			await vi.waitFor(() => expect(streams.output()).toContain("Actions:"), { timeout: CI_RENDER_TIMEOUT });
			await send(streams.stdin, "\r", "\r", "\x13");
			expect(await instance.waitUntilExit()).toEqual({ reason: "submit" });
			expect(events).toEqual(["callback"]);
			expect(streams.raw).toHaveBeenLastCalledWith(false);
			form.dispose();
		},
		CI_RENDER_TIMEOUT + 5_000,
	);

	it("continues reverse cleanup and aggregates terminal and ownership failures", async () => {
		const streams = fakeStreams();
		streams.raw.mockImplementation((enabled) => {
			if (!enabled) throw new Error("raw cleanup");
			return streams.stdin;
		});
		const form = makeForm();
		const owned = {
			...form,
			dispose: () => {
				form.dispose();
				throw new Error("form cleanup");
			},
		};
		const instance = renderStandaloneForm({ form: owned, schema, ...streams, formOwnership: "host" });
		instance.unmount();
		const error = await instance.waitUntilExit().catch((reason) => reason);
		expect(error).toBeInstanceOf(AggregateError);
		expect((error as AggregateError).errors.map(String)).toEqual(
			expect.arrayContaining([expect.stringContaining("raw cleanup"), expect.stringContaining("form cleanup")]),
		);
		expect(form.isDisposed()).toBe(true);
		streams.raw.mockImplementation(() => streams.stdin);
		const replacement = renderStandaloneForm({ form: makeForm(), schema, ...streams });
		replacement.unmount();
		await replacement.waitUntilExit();
	});
});

describe("standalone local resolver", () => {
	it("validates batches atomically and reports explicit binding states after revision updates", () => {
		const host = createStandaloneInteraction();
		const target = { kind: "field" as const, path: "name" };
		expect(() =>
			host.capability.contributeDefaultBindings([
				{ input: "enter", interaction: { action: "activate", target }, label: "one" },
				{ input: "enter", interaction: { action: "activate", target }, label: "two" },
			]),
		).toThrow(/Duplicate/);
		expect(host.capability.getEffectiveBinding("enter")).toEqual({ input: "enter", status: "unbound" });
		const revisions: number[] = [];
		host.capability.subscribe(() => revisions.push(host.capability.getRevision()));
		const removeFirst = host.capability.contributeDefaultBindings([
			{ input: "enter", interaction: { action: "activate", target }, label: "one" },
		]);
		expect(host.capability.getEffectiveBinding("enter").status).toBe("bound");
		const removeSecond = host.capability.contributeDefaultBindings([
			{ input: "enter", interaction: { action: "activate", target }, label: "two" },
		]);
		expect(host.capability.getEffectiveBinding("enter").status).toBe("conflicted");
		removeSecond();
		removeSecond();
		expect(host.capability.getEffectiveBinding("enter").status).toBe("bound");
		removeFirst();
		expect(revisions).toEqual([1, 2, 3, 4]);
	});

	it("contains observer failures while notifying later listeners for registration and cleanup revisions", () => {
		const host = createStandaloneInteraction();
		const target = { kind: "field" as const, path: "name" };
		const first = vi.fn(() => {
			throw new Error("observer");
		});
		const revisions: number[] = [];
		host.capability.subscribe(first);
		host.capability.subscribe(() => revisions.push(host.capability.getRevision()));
		const cleanup = host.capability.contributeDefaultBindings([
			{ input: "enter", interaction: { action: "activate", target }, label: "go" },
		]);
		expect(host.capability.getRevision()).toBe(1);
		expect(host.capability.getEffectiveBinding("enter").status).toBe("bound");
		expect(revisions).toEqual([1]);
		expect(() => cleanup()).not.toThrow();
		expect(host.capability.getRevision()).toBe(2);
		expect(host.capability.getEffectiveBinding("enter")).toEqual({ input: "enter", status: "unbound" });
		expect(revisions).toEqual([1, 2]);
		expect(first).toHaveBeenCalledTimes(2);
	});

	it("runs action handlers in reverse order, then only a unique target, and propagates exceptions", () => {
		const host = createStandaloneInteraction();
		const target = { kind: "field" as const, path: "name" };
		host.capability.contributeDefaultBindings([
			{ input: "enter", interaction: { action: "activate", target }, label: "go" },
		]);
		const calls: string[] = [];
		host.capability.registerActions([
			{
				id: "activate",
				invoke: () => {
					calls.push("first");
					return true;
				},
			},
		]);
		const removeLast = host.capability.registerActions([
			{
				id: "activate",
				invoke: () => {
					calls.push("last");
					return false;
				},
			},
		]);
		expect(host.dispatch("enter")).toBe(true);
		expect(calls).toEqual(["last", "first"]);
		removeLast();
		host.capability.registerActions([
			{
				id: "activate",
				invoke: () => {
					throw new Error("handler");
				},
			},
		]);
		expect(() => host.dispatch("enter")).toThrow("handler");
	});
});

function makeForm(): FormApi<Record<string, unknown>, unknown> {
	return createForm({ initialData: { name: "Ada" }, onSubmit: async () => ({ ok: true, submitId: "test" }) });
}

function fakeStreams() {
	const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
	const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
	const stderr = new PassThrough() as PassThrough & NodeJS.WriteStream;
	const raw = vi.fn<(mode: boolean) => NodeJS.ReadStream>(() => stdin);
	Object.assign(stdin, { isTTY: true, setRawMode: raw, ref: vi.fn(() => stdin), unref: vi.fn(() => stdin) });
	Object.assign(stdout, { isTTY: true, columns: 80, rows: 24 });
	Object.assign(stderr, { isTTY: true, columns: 80, rows: 24 });
	let rendered = "";
	stdout.on("data", (chunk) => {
		rendered += chunk.toString();
	});
	return { stdin, stdout, stderr, raw, output: () => rendered };
}

async function send(stdin: PassThrough, ...inputs: string[]): Promise<void> {
	for (const input of inputs) {
		stdin.write(input);
		await new Promise((resolve) => setTimeout(resolve, 30));
	}
}
