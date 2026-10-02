import { compileFsx } from "@formbar/fsx-authoring";
import { describe, expect, it, vi } from "vitest";
import {
	acceptFsxDocument,
	applyFsx,
	applyFsxFromHost,
	compileOptions,
	installFsxDocument,
	retireFsxDocument,
} from "../fsx/compile";
import { fsxExamples } from "../fsx/registry";
import { readRoute, resolveRoute } from "../playground/route";
import {
	acceptDemoDraft,
	bindDemoDraft,
	captureDemoDraft,
	disposeDemoSession,
	installDemo,
	installDemoSession,
	invokeDemoDraft,
	retireDemoDraft,
} from "../runtime/kalada-demo-install";

const [quote, lines] = fsxExamples;
const apply = (example = quote, source = example.source, data = JSON.stringify(example.data)) => {
	const result = applyFsx(example, source, data);
	expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
	if (!result.ok) throw new Error("Apply failed");
	return result.document;
};

function boundDraft() {
	const source = installDemo(apply());
	const captured = captureDemoDraft(source, quote.schema);
	const document = { ...apply(), initialData: captured.data };
	const revision = Object.freeze({});
	const permit = bindDemoDraft(captured.token, document, quote.id, revision, quote.source);
	return { source, captured, document, revision, permit };
}

function installUse(document: ReturnType<typeof apply>, use: object) {
	return installDemoSession(document, undefined, undefined, undefined, undefined, undefined, undefined, use);
}

describe("app-owned FSX installation", () => {
	it("mutating caller-exposed capture data cannot rewrite immutable authorization or the source", () => {
		const source = installDemo(apply());
		const capture = captureDemoDraft(source, quote.schema);
		Object.assign(capture.data, { quantity: null, unitPrice: null });
		const document = { ...apply(), initialData: capture.data };
		expect(() => installUse(document, capture.token)).toThrow("Invalid owned draft capability");
		expect(() => bindDemoDraft(capture.token, document, quote.id, {}, quote.source)).toThrow("Modified captured draft");
		expect(source.snapshot().data).toEqual(quote.data);
		disposeDemoSession(source);
	});
	it.each([999, null])("modified returned initialData=%s is denied before destination mount", (quantity) => {
		const source = installDemo(apply());
		const result = applyFsxFromHost(quote, quote.source, source);
		if (!result.ok) throw new Error("Preflight failed");
		Object.assign(result.document.initialData, { quantity });
		expect(() => acceptFsxDocument(result.document, {})).toThrow("modified draft destination");
		expect(source.snapshot().data).toEqual(quote.data);
		disposeDemoSession(source);
	});
	it.each([999, null])("already accepted destination still rejects payload mutation=%s before mount", (quantity) => {
		const source = installDemo(apply());
		const owner = Object.freeze({});
		const result = applyFsxFromHost(quote, quote.source, source);
		if (!result.ok) throw new Error("Preflight failed");
		acceptFsxDocument(result.document, owner);
		disposeDemoSession(source);
		Object.assign(result.document.initialData, { quantity });
		expect(() => installFsxDocument(result.document, undefined, owner)).toThrow("modified draft destination");
		retireFsxDocument(result.document, owner);
	});
	it("nested caller row mutation cannot alter the frozen authorization snapshot", () => {
		const source = installDemo(apply(lines));
		const capture = captureDemoDraft(source, lines.schema);
		if (!Array.isArray(capture.data.rows)) throw new Error("Missing rows");
		Object.assign(capture.data.rows[0], { amount: null });
		const document = { ...apply(lines), initialData: capture.data };
		expect(() => bindDemoDraft(capture.token, document, lines.id, {}, lines.source)).toThrow("Modified captured draft");
		expect(source.snapshot().data).toEqual(lines.data);
		disposeDemoSession(source);
	});
	it("one intended document/preset/source revision binds preflight and redemption", () => {
		const draft = boundDraft();
		const owner = Object.freeze({});
		if (!draft.document.definition) throw new Error("Missing definition");
		const foreign = { ...draft.document, definition: { ...draft.document.definition, id: "foreign" } };
		expect(() => installUse(foreign, draft.permit)).toThrow("Foreign or modified");
		expect(() => installUse(structuredClone(draft.document), draft.permit)).toThrow("Foreign or modified");
		expect(() =>
			acceptDemoDraft(draft.permit, draft.document, owner, "line-items", draft.revision, quote.source),
		).toThrow("Foreign preset");
		expect(() => acceptDemoDraft(draft.permit, draft.document, owner, quote.id, {}, quote.source)).toThrow(
			"source revision",
		);
		expect(() =>
			acceptDemoDraft(draft.permit, draft.document, owner, quote.id, draft.revision, `${quote.source} `),
		).toThrow("source revision");
		const temporary = installUse(draft.document, draft.permit);
		disposeDemoSession(temporary);
		const scope = acceptDemoDraft(draft.permit, draft.document, owner, quote.id, draft.revision, quote.source);
		expect(() => installUse(draft.document, draft.permit)).toThrow("Invalid owned draft capability");
		expect(() => acceptDemoDraft(draft.permit, draft.document, owner, quote.id, draft.revision, quote.source)).toThrow(
			"redeemed",
		);
		retireDemoDraft(scope, owner);
		disposeDemoSession(draft.source);
	});
	it("foreign form/preset cannot obtain even the first bound permit", () => {
		const source = installDemo(apply());
		const captured = captureDemoDraft(source, quote.schema);
		const document = { ...apply(), initialData: captured.data };
		if (!document.definition) throw new Error("Missing definition");
		const foreign = { ...document, definition: { ...document.definition, id: "foreign" } };
		expect(() => bindDemoDraft(captured.token, foreign, quote.id, {}, quote.source)).toThrow(
			"Foreign draft preset or form",
		);
		expect(() => bindDemoDraft(captured.token, document, "line-items", {}, quote.source)).toThrow(
			"Foreign draft preset or form",
		);
		disposeDemoSession(source);
	});
	it.each(["disposed", "changed"])("%s origin refuses first grant redemption", (operation) => {
		const draft = boundDraft();
		if (operation === "disposed") disposeDemoSession(draft.source);
		else expect(draft.source.snapshot().controls[0].writers.value?.("Changed").status).toBe("applied");
		expect(() => installUse(draft.document, draft.permit)).toThrow("Stale or revoked draft origin");
		expect(() => acceptDemoDraft(draft.permit, draft.document, {}, quote.id, draft.revision, quote.source)).toThrow(
			"Stale or revoked draft origin",
		);
		disposeDemoSession(draft.source);
	});
	it("accepted destinations replay only for their owner, with one-shot invocations and lifecycle retirement", () => {
		const draft = boundDraft();
		const owner = Object.freeze({});
		const scope = acceptDemoDraft(draft.permit, draft.document, owner, quote.id, draft.revision, quote.source);
		disposeDemoSession(draft.source);
		expect(() => invokeDemoDraft(scope, {}, quote.id, draft.revision, quote.source)).toThrow("Foreign or retired");
		expect(() => installUse(draft.document, scope)).toThrow("Invalid owned draft capability");
		const use = invokeDemoDraft(scope, owner, quote.id, draft.revision, quote.source);
		const mounted = installUse(draft.document, use);
		expect(() => installUse(draft.document, use)).toThrow("Invalid owned draft capability");
		const replay = installUse(draft.document, invokeDemoDraft(scope, owner, quote.id, draft.revision, quote.source));
		const writer = mounted.snapshot().controls[0].writers.value;
		retireDemoDraft(scope, owner);
		expect(writer?.("Retired").status).not.toBe("applied");
		expect(replay.currentRevision()).toBeUndefined();
		expect(() => invokeDemoDraft(scope, owner, quote.id, draft.revision, quote.source)).toThrow("retired");
	});
	it("destination comparison rejects accessors and toJSON executables without invoking them", () => {
		const draft = boundDraft();
		const getter = vi.fn(() => 999);
		const execute = vi.fn();
		Object.defineProperty(draft.document.initialData, "quantity", { enumerable: true, get: getter });
		expect(() => installUse(draft.document, draft.permit)).toThrow();
		expect(getter).not.toHaveBeenCalled();
		Object.defineProperty(draft.document.initialData, "quantity", { enumerable: true, value: 2 });
		Object.defineProperty(draft.document.initialData, "toJSON", { enumerable: true, value: execute });
		expect(() => installUse(draft.document, draft.permit)).toThrow();
		expect(execute).not.toHaveBeenCalled();
		disposeDemoSession(draft.source);
	});
	it("field-only retained null uses an opaque initialization capability, not portable JSON authority", () => {
		const source =
			'<Form id="field-only" defaultLanguage="Kalada"><Field id="quantity" widget="number" value={quantity}/></Form>';
		const first = installDemo(apply(quote, source));
		expect(first.snapshot().controls[0].writers.value?.(null).status).toBe("applied");
		const result = applyFsxFromHost(quote, source, first);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Retained null was rejected");
		const owner = Object.freeze({});
		acceptFsxDocument(result.document, owner);
		disposeDemoSession(first);
		const next = installFsxDocument(result.document, undefined, owner);
		expect(next.snapshot().data).toMatchObject({ quantity: null });
		expect(() => installFsxDocument(structuredClone(result.document))).toThrow();
		expect(() =>
			installDemoSession(result.document, undefined, undefined, undefined, undefined, undefined, undefined, {}),
		).toThrow("Invalid owned draft capability");
		expect(applyFsx(quote, source, JSON.stringify(result.document.initialData)).ok).toBe(false);
		disposeDemoSession(first);
		disposeDemoSession(next);
		retireFsxDocument(result.document, owner);
	});
	it("retained drafts are detached and bounded without granting new references", () => {
		const host = installDemo(apply());
		const result = applyFsxFromHost(quote, quote.source, host);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Retained Apply failed");
		expect(
			host
				.snapshot()
				.controls.find(({ nodeId }) => nodeId === "name")
				?.writers.value?.("Grace").status,
		).toBe("applied");
		expect(result.document.initialData).toEqual(quote.data);
		const invalid = applyFsxFromHost(quote, quote.source.replace("value={name}", "value={secret}"), host);
		expect(invalid.ok).toBe(false);
		expect(invalid).not.toHaveProperty("document");
		expect(
			host
				.snapshot()
				.controls.find(({ nodeId }) => nodeId === "name")
				?.writers.value?.("x".repeat(100_001)).status,
		).not.toBe("applied");
		expect(host.snapshot().data).toMatchObject({ name: "Grace" });
		disposeDemoSession(host);
	});
	it("retention does not admit another preset's shape or a retired host", () => {
		const foreign = installDemo(apply(lines));
		expect(applyFsxFromHost(quote, quote.source, foreign)).toMatchObject({ ok: false });
		disposeDemoSession(foreign);
		const retired = installDemo(apply());
		disposeDemoSession(retired);
		expect(applyFsxFromHost(quote, quote.source, retired)).toMatchObject({ ok: false });
	});
	it("canonicalizes only registered deep links without changing JSON routes", () => {
		const url = new URL("https://example.com/formbar/?mode=fsx&demo=line-items&preset=bad");
		expect(readRoute(url, ["contact"], [])).toEqual({ mode: "playground", demoId: "fsx-line-items" });
		const result = resolveRoute(url, { mode: "fsx", demoId: "unknown" }, ["contact"], []);
		expect(result.route).toEqual({ mode: "playground", demoId: "fsx-quote" });
		expect(result.url.searchParams.has("preset")).toBe(false);
		expect(readRoute(new URL("https://example.com/?demo=contact"), ["contact"], [])).toEqual({
			mode: "demo",
			demoId: "contact",
		});
	});
	it("compiles using only identity inspection, never runtime capabilities", () => {
		const options = compileOptions(quote);
		const capture = vi.fn(() => {
			throw new Error("Compile executed capture");
		});
		const current = vi.fn(() => {
			throw new Error("Compile executed current");
		});
		const result = compileFsx(quote.source, {
			...options,
			admission: { ...options.admission, strategy: { ...options.admission.strategy, capture, current } },
		});
		expect(result.ok).toBe(true);
		expect(capture).not.toHaveBeenCalled();
		expect(current).not.toHaveBeenCalled();
	});
	it("reacts to scalar writes without recompilation and submits current data", async () => {
		const submit = vi.fn();
		const host = installDemo(apply(), submit);
		const first = host.snapshot();
		expect(first.outputs.find(({ nodeId }) => nodeId === "total")?.value).toBe(25);
		expect(first.controls.find(({ nodeId }) => nodeId === "quantity")?.writers.value?.(6)).toEqual({
			status: "applied",
		});
		expect(host.snapshot().outputs.find(({ nodeId }) => nodeId === "total")?.value).toBe(75);
		expect(host.snapshot().outputs.some(({ nodeId }) => nodeId === "bulk-message")).toBe(true);
		expect(await host.submit()).toMatchObject({ status: "submitted" });
		expect(submit).toHaveBeenCalledWith({ name: "Ada", quantity: 6, unitPrice: 12.5 });
		disposeDemoSession(host);
	});
	it("writes whole primitive and object rows with stable tokens and refuses old writers", () => {
		const host = installDemo(apply(lines));
		const first = host.snapshot();
		const write = first.controls.find(({ value }) => value === "urgent")?.writers.value;
		expect(write?.("priority")).toEqual({ status: "applied" });
		expect(host.snapshot().rows.map(({ key }) => key)).toEqual(first.rows.map(({ key }) => key));
		expect(write?.("stale").status).not.toBe("applied");
		const amount = host.snapshot().controls.find(({ value }) => value === 20)?.writers.value;
		expect(amount?.(30).status).toBe("applied");
		expect(host.snapshot().outputs.find(({ nodeId }) => nodeId === "double")?.value).toBe(60);
		disposeDemoSession(host);
		expect(amount?.(99).status).not.toBe("applied");
	});
	it("reorders/removes atomically and revokes retained row writes/actions", async () => {
		const host = installDemo(apply(lines));
		const first = host.snapshot();
		const repeater = first.tree.children?.[0];
		const move = repeater?.rows?.[0].children.find(({ action }) => action?.name === "array.move")?.action;
		const old = first.controls.find(({ value }) => value === "Design")?.writers.value;
		expect((await move?.invoke(repeater?.rows?.[1].key))?.status).toBe("applied");
		const after = host.snapshot();
		expect(after.rows.map(({ key }) => key)).toEqual([
			first.rows[1].key,
			first.rows[0].key,
			...first.rows.slice(2).map(({ key }) => key),
		]);
		expect(old?.("wrong row").status).not.toBe("applied");
		expect((await move?.invoke(first.rows[0].key))?.status).not.toBe("applied");
		const removed = after.controls.find(({ value }) => value === "Review")?.writers.value;
		const remove = after.tree.children?.[0].rows?.[0].children.find(
			({ action }) => action?.name === "array.remove",
		)?.action;
		expect((await remove?.invoke())?.status).toBe("applied");
		expect(removed?.("resurrected").status).not.toBe("applied");
		expect(host.snapshot().data).toMatchObject({ rows: [{ description: "Design", amount: 20 }] });
		disposeDemoSession(host);
	});
	it.each([
		["value={name}", "value={secret}"],
		["value={quantity}", "value={quantity + 1}"],
		['label="Customer"', "onChange={alert(1)}"],
		['id="name"', "id={name}"],
		['widget="text"', 'widget="uninstalled"'],
	])("fails closed for %s → %s with exact source diagnostics", (before, after) => {
		const result = applyFsx(quote, quote.source.replace(before, after), JSON.stringify(quote.data));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result).not.toHaveProperty("definition");
		expect(result.diagnostics[0].path).toBeTruthy();
		expect(result.diagnostics[0].range).toEqual(
			expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
		);
	});
	it.each([
		"null",
		'{"name":42}',
		'{"name":"Ada","quantity":"2","unitPrice":1}',
		'{"__proto__":{}}',
		'{"constructor":{}}',
		"{",
		'{"extra":true}',
	])("rejects unsafe/malformed/wrong-type JSON without adding authority: %s", (data) => {
		expect(applyFsx(quote, quote.source, data).ok).toBe(false);
	});
});
