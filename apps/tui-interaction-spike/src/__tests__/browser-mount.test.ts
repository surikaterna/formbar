import { describe, expect, it } from "vitest";
import { acquireBrowserMount, disposeInkInstance } from "../browser-mount.js";

describe("browser mount transaction", () => {
	it("releases every acquired resource in reverse when Ink render fails", () => {
		const events: string[] = [];
		const resource = (name: string) => ({ name, disposed: false });
		const form = resource("form");
		const scope = resource("scope");
		const text = resource("text");
		const subscription = (name: string) => () => events.push(`dispose:${name}`);
		expect(() =>
			acquireBrowserMount({
				createForm: () => {
					events.push("acquire:form");
					return form;
				},
				disposeForm: (value) => {
					value.disposed = true;
					events.push("dispose:form");
				},
				createScope: () => {
					events.push("acquire:scope");
					return scope;
				},
				disposeScope: (value) => {
					value.disposed = true;
					events.push("dispose:scope");
				},
				createTextInput: () => {
					events.push("acquire:text");
					return text;
				},
				disposeTextInput: (value) => {
					value.disposed = true;
					events.push("dispose:text");
				},
				acquireData: () => subscription("data"),
				acquirePaste: () => subscription("paste"),
				acquireResize: () => subscription("resize"),
				acquireForm: () => subscription("form-subscription"),
				renderInk: () => {
					throw new Error("injected Ink render failure");
				},
				disposeInk: () => events.push("dispose:ink"),
			}),
		).toThrow("injected Ink render failure");
		expect(events.slice(-7)).toEqual([
			"dispose:form-subscription",
			"dispose:resize",
			"dispose:paste",
			"dispose:data",
			"dispose:text",
			"dispose:scope",
			"dispose:form",
		]);
		expect([form.disposed, scope.disposed, text.disposed]).toEqual([true, true, true]);
	});

	it("retains the render error while attempting every throwing disposer", () => {
		const disposed: string[] = [];
		const primary = new Error("render primary");
		const throwing = (name: string) => () => {
			disposed.push(name);
			throw new Error(`${name} cleanup`);
		};
		let caught: unknown;
		try {
			acquireBrowserMount({
				createForm: () => "form",
				disposeForm: () => disposed.push("form"),
				createScope: () => "scope",
				disposeScope: () => disposed.push("scope"),
				createTextInput: () => "text",
				disposeTextInput: () => disposed.push("text"),
				acquireData: () => throwing("data"),
				acquirePaste: () => () => disposed.push("paste"),
				acquireResize: () => throwing("resize"),
				acquireForm: () => () => disposed.push("form-subscription"),
				renderInk: () => {
					throw primary;
				},
				disposeInk: () => disposed.push("ink"),
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(AggregateError);
		expect((caught as AggregateError).cause).toBe(primary);
		expect((caught as AggregateError).errors[0]).toBe(primary);
		expect(disposed).toEqual(["form-subscription", "resize", "paste", "data", "text", "scope", "form"]);
	});

	it("runs Ink cleanup and later disposers after unmount failures", () => {
		const disposed: string[] = [];
		const unmountError = new Error("unmount primary");
		const lifecycle = acquireBrowserMount({
			createForm: () => "form",
			disposeForm: () => disposed.push("form"),
			createScope: () => "scope",
			disposeScope: () => disposed.push("scope"),
			createTextInput: () => "text",
			disposeTextInput: () => disposed.push("text"),
			acquireData: () => () => disposed.push("data"),
			acquirePaste: () => () => disposed.push("paste"),
			acquireResize: () => () => disposed.push("resize"),
			acquireForm: () => () => {
				disposed.push("form-subscription");
				throw new Error("form subscription cleanup");
			},
			renderInk: () => ({
				unmount: () => {
					disposed.push("ink-unmount");
					throw unmountError;
				},
				cleanup: () => {
					disposed.push("ink-cleanup");
					throw new Error("ink cleanup");
				},
			}),
			disposeInk: disposeInkInstance,
		});
		let caught: unknown;
		try {
			lifecycle.dispose();
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(AggregateError);
		const inkFailure = (caught as AggregateError).cause as AggregateError;
		expect(inkFailure.cause).toBe(unmountError);
		expect(disposed).toEqual([
			"ink-unmount",
			"ink-cleanup",
			"form-subscription",
			"resize",
			"paste",
			"data",
			"text",
			"scope",
			"form",
		]);
	});
});
