import { KALADA_V1_ARTIFACT, createFormRuntime, validateFormDefinition } from "@formbar/declarative";
import { expect, it, vi } from "vitest";
import { compileFsx } from "../index.js";
import { fixture } from "./fixture.js";

const text = '<Form id="receipt" defaultLanguage="Kalada"/>';
const receipt = () => ({ artifact: KALADA_V1_ARTIFACT, policyGeneration: "g1", policyFingerprint: "host" });

it.each(["artifact", "policyGeneration", "policyFingerprint"])(
	"rejects returned identity %s accessor without invoking it",
	(key) => {
		const { options } = fixture();
		const getter = vi.fn(() => "never");
		const returned = Object.defineProperty(receipt(), key, { get: getter });
		const identity = vi.fn(() => returned);
		const capture = vi.fn(options.admission.strategy.capture);
		const writeDirect = vi.fn(options.admission.strategy.writeDirect);
		const strategy = { ...options.admission.strategy, identity, capture, writeDirect };
		const supplied = { ...options, admission: { ...options.admission, strategy } };
		expect(compileFsx(text, supplied)).toMatchObject({
			ok: false,
			diagnostics: [{ code: "kalada-admission", path: "root", message: "STALE_INSTALLATION" }],
		});
		expect(identity).toHaveBeenCalledOnce();
		expect(getter).not.toHaveBeenCalled();
		expect(capture).not.toHaveBeenCalled();
		expect(writeDirect).not.toHaveBeenCalled();
		expect(
			validateFormDefinition(
				{ version: 1, id: "public", root: { type: "group", id: "root", children: [] } },
				supplied.admission,
			),
		).toMatchObject({ ok: false, diagnostics: [{ path: ["root"], message: "STALE_INSTALLATION" }] });
		expect(getter).not.toHaveBeenCalled();
	},
);

it.each(["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"])(
	"fails closed on returned identity throwing %s proxy trap",
	(trap) => {
		const { options } = fixture();
		const getter = vi.fn();
		const returned = new Proxy(receipt(), {
			get: getter,
			[trap]: () => {
				throw new Error("receipt trap");
			},
		});
		const strategy = { ...options.admission.strategy, identity: () => returned };
		expect(compileFsx(text, { ...options, admission: { ...options.admission, strategy } })).toMatchObject({
			ok: false,
			diagnostics: [{ path: "root", message: "STALE_INSTALLATION" }],
		});
		expect(getter).not.toHaveBeenCalled();
	},
);

it("rejects inherited fields, extra keys, nonprimitive or unbounded identity metadata", () => {
	const { options } = fixture();
	for (const returned of [
		Object.create(receipt()),
		{ ...receipt(), extra: "unsupported" },
		{ ...receipt(), artifact: 1 },
		{ ...receipt(), policyGeneration: "x".repeat(2049) },
	]) {
		const strategy = { ...options.admission.strategy, identity: () => returned };
		expect(compileFsx(text, { ...options, admission: { ...options.admission, strategy } })).toMatchObject({
			ok: false,
			diagnostics: [{ path: "root", message: "STALE_INSTALLATION" }],
		});
	}
});

it("rechecks returned identity data safely at runtime installation before capturing or subscribing", () => {
	const { options } = fixture();
	const result = compileFsx(text, options);
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	const getter = vi.fn(() => KALADA_V1_ARTIFACT);
	const returned = Object.defineProperty(receipt(), "artifact", { get: getter });
	Object.defineProperty(options.admission.strategy, "identity", { value: () => returned });
	const capture = vi.spyOn(options.admission.strategy, "capture");
	const subscribe = vi.spyOn(options.admission.strategy, "subscribe");
	expect(() => createFormRuntime({ definition: result.validated })).toThrow("root: STALE_INSTALLATION");
	expect(getter).not.toHaveBeenCalled();
	expect(capture).not.toHaveBeenCalled();
	expect(subscribe).not.toHaveBeenCalled();
});
