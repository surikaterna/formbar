import { describe, expect, it, vi } from "vitest";
import type { DefaultBindingContribution, InteractionTarget } from "../index.js";
import { FakeInteractionHost, FakeTextInputSource } from "./fake-interaction-host.js";

const field = (path: string): InteractionTarget => ({ kind: "field", path });
const group = (id: string): InteractionTarget => ({ kind: "group", id });
const binding = (input: string, action: string, target: InteractionTarget): DefaultBindingContribution => ({
	input,
	interaction: { action, target },
	label: `${input} label`,
});

describe("public interaction contract", () => {
	it("returns explicit unbound, bound, and conflicted resolutions", () => {
		const host = new FakeInteractionHost();
		expect(host.getEffectiveBinding("enter")).toEqual({ input: "enter", status: "unbound" });
		host.contributeDefaultBindings([binding("enter", "open", group("same"))]);
		expect(host.getEffectiveBinding("enter")).toMatchObject({ status: "bound", label: "enter label" });
		host.contributeDefaultBindings([binding("enter", "edit", field("same"))]);
		expect(host.getEffectiveBinding("enter")).toEqual({ input: "enter", status: "conflicted" });
	});

	it("keeps field paths and group IDs as distinct local target identities", () => {
		const host = new FakeInteractionHost();
		const fieldInvoke = vi.fn(() => true);
		const groupInvoke = vi.fn(() => true);
		host.registerTargets([
			{ target: field("same"), invoke: fieldInvoke },
			{ target: group("same"), invoke: groupInvoke },
		]);
		host.contributeDefaultBindings([binding("enter", "open", field("same"))]);
		expect(host.dispatch("enter")).toBe(true);
		expect(fieldInvoke).toHaveBeenCalledWith("open");
		expect(groupInvoke).not.toHaveBeenCalled();
	});

	it("allows batches to coexist and each cleanup removes only its own batch", () => {
		const host = new FakeInteractionHost();
		const removeEnter = host.contributeDefaultBindings([binding("enter", "open", group("a"))]);
		host.contributeDefaultBindings([binding("tab", "next", group("a"))]);
		removeEnter();
		removeEnter();
		expect(host.getEffectiveBinding("enter").status).toBe("unbound");
		expect(host.getEffectiveBinding("tab").status).toBe("bound");
	});

	it("rejects a bad registration batch atomically", () => {
		const host = new FakeInteractionHost();
		const before = host.getRevision();
		expect(() =>
			host.registerTargets([
				{ target: field("name"), invoke: () => true },
				{ target: field("name"), invoke: () => true },
			]),
		).toThrow("Duplicate registration");
		expect(host.getRevision()).toBe(before);
	});

	it("advances revision before notifying and does not initially emit", () => {
		const host = new FakeInteractionHost();
		const observed: number[] = [];
		host.subscribe(() => observed.push(host.getRevision()));
		expect(observed).toEqual([]);
		host.contributeDefaultBindings([binding("enter", "open", group("a"))]);
		expect(observed).toEqual([1]);
	});

	it("cleans subscriptions idempotently", () => {
		const host = new FakeInteractionHost();
		const listener = vi.fn();
		const cleanup = host.subscribe(listener);
		cleanup();
		cleanup();
		host.contributeDefaultBindings([binding("enter", "open", group("a"))]);
		expect(listener).not.toHaveBeenCalled();
	});

	it("supports the revision-read/subscribe/re-read missed-update check", () => {
		const host = new FakeInteractionHost();
		const first = host.getRevision();
		host.contributeDefaultBindings([binding("enter", "open", group("a"))]);
		const cleanup = host.subscribe(() => undefined);
		expect(host.getRevision()).toBeGreaterThan(first);
		cleanup();
	});

	it("survives StrictMode-shaped setup, cleanup, setup", () => {
		const host = new FakeInteractionHost();
		const setup = () => host.contributeDefaultBindings([binding("enter", "open", group("a"))]);
		setup()();
		const activeCleanup = setup();
		expect(host.getEffectiveBinding("enter").status).toBe("bound");
		activeCleanup();
		expect(host.getEffectiveBinding("enter").status).toBe("unbound");
	});

	it("removes the old capability registrations when a capability is replaced", () => {
		const oldHost = new FakeInteractionHost();
		const nextHost = new FakeInteractionHost();
		const oldCleanup = oldHost.contributeDefaultBindings([binding("enter", "open", group("a"))]);
		oldCleanup();
		nextHost.contributeDefaultBindings([binding("enter", "open", group("a"))]);
		expect(oldHost.getEffectiveBinding("enter").status).toBe("unbound");
		expect(nextHost.getEffectiveBinding("enter").status).toBe("bound");
	});

	it("keeps printable and pasted text independent from named controls", () => {
		const host = new FakeInteractionHost();
		const text = new FakeTextInputSource();
		const received: string[] = [];
		const action = vi.fn(() => true);
		text.subscribe((value) => received.push(value));
		host.registerActions([{ id: "open", invoke: action }]);
		host.contributeDefaultBindings([binding("enter", "open", group("a"))]);
		text.emit("pasted text");
		expect(received).toEqual(["pasted text"]);
		expect(action).not.toHaveBeenCalled();
	});

	it("propagates invocation errors", () => {
		const host = new FakeInteractionHost();
		host.registerActions([
			{
				id: "open",
				invoke: () => {
					throw new Error("invoke failed");
				},
			},
		]);
		host.contributeDefaultBindings([binding("enter", "open", group("a"))]);
		expect(() => host.dispatch("enter")).toThrow("invoke failed");
	});
});
