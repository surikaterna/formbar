import type { SchemaFieldInfo } from "@formbar/from-schema";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TUI_FIELD_ADAPTER_REGISTRY, type TuiFieldAdapter, createTuiFieldAdapterRegistry } from "../index.js";

const field = (type: string, metadata: Record<string, unknown> = {}): SchemaFieldInfo => ({
	path: "value",
	type: type as SchemaFieldInfo["type"],
	required: false,
	metadata,
});

const resolve = (
	candidate: SchemaFieldInfo,
	options: readonly { value: unknown; title: string; disabled?: boolean }[] = [],
) => DEFAULT_TUI_FIELD_ADAPTER_REGISTRY.resolve({ field: candidate, options });

describe("TUI field adapter registry", () => {
	it("is immutable, snapshots adapters, validates ids, and gives extensions first-match precedence", () => {
		const custom: TuiFieldAdapter = {
			id: "custom",
			matches: () => true,
			create: () => ({
				mode: "text",
				toDraft: () => ({ ok: true, value: "custom" }),
				acceptsDraft: () => true,
				fromDraft: () => ({ ok: true, value: "custom" }),
			}),
		};
		const source = [custom];
		const registry = createTuiFieldAdapterRegistry(source);
		source.length = 0;
		expect(registry.snapshot()[0]?.id).toBe("custom");
		expect(registry.resolve({ field: field("string"), options: [] }).adapterId).toBe("custom");
		expect(() => registry.extend([custom])).toThrow(/Duplicate/);
		expect(() => createTuiFieldAdapterRegistry([{ ...custom, id: " " }])).toThrow(/nonempty/);
		expect(() => createTuiFieldAdapterRegistry([{ ...custom, id: "safe-string" }])).toThrow(/Duplicate/);
		expect(
			registry
				.replace([custom])
				.snapshot()
				.map(({ id }) => id),
		).toEqual(["custom"]);
	});

	it("contains adapter failures and keeps the masked gate non-overridable", () => {
		const create = vi.fn(() => {
			throw new Error("secret failure");
		});
		const broken: TuiFieldAdapter = { id: "broken", matches: () => true, create };
		expect(
			createTuiFieldAdapterRegistry([broken]).resolve({ field: field("object"), options: [] }).diagnostics[0]?.message,
		).toBe("Field adapter failed");
		const masked = createTuiFieldAdapterRegistry([broken], "replace").resolve({
			field: field("string", { writeOnly: true }),
			options: [],
		});
		expect(masked).toMatchObject({ adapterId: "masked-text", diagnostics: [] });
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("supports safe built-ins and rejects unsupported types, formats, widgets, and initial values", () => {
		expect(resolve(field("string")).codec?.toDraft("hello")).toEqual({ ok: true, value: "hello" });
		expect(resolve(field("string")).codec?.toDraft(1).ok).toBe(false);
		expect(resolve(field("boolean")).codec?.mode).toBe("boolean");
		for (const candidate of [
			field("object"),
			field("array"),
			field("string", { format: "date" }),
			field("string", { format: "time" }),
			field("string", { format: "binary" }),
			field("string", { widget: "file" }),
			field("string", { widget: "textarea" }),
		]) {
			expect(resolve(candidate).codec).toBeUndefined();
			expect(resolve(candidate, [{ value: "x", title: "X" }]).codec).toBeUndefined();
		}
	});

	it("enforces numeric grammar, bounds, finite numbers, and safe integers", () => {
		const number = resolve(field("number", { minimum: 0, exclusiveMaximum: 10 })).codec;
		expect(number?.acceptsDraft("-.5")).toBe(true);
		expect(number?.acceptsDraft("01")).toBe(false);
		expect(number?.fromDraft("1e2").ok).toBe(false);
		expect(number?.fromDraft("9.5")).toEqual({ ok: true, value: 9.5 });
		expect(number?.fromDraft("Infinity").ok).toBe(false);
		const integer = resolve(field("integer")).codec;
		expect(integer?.fromDraft(String(Number.MAX_SAFE_INTEGER))).toEqual({ ok: true, value: Number.MAX_SAFE_INTEGER });
		expect(integer?.fromDraft("9007199254740992").ok).toBe(false);
	});

	it("uses Object.is option identity and reports invalid and duplicate primitive values", () => {
		const options = [
			{ value: 0, title: "zero" },
			{ value: -0, title: "negative zero" },
			{ value: "0", title: "text" },
		];
		const codec = resolve(field("number"), options).codec;
		expect(codec?.toDraft(-0).ok).toBe(true);
		expect(codec?.options).toHaveLength(3);
		const duplicate = resolve(field("number"), [...options, { value: -0, title: "again" }]).diagnostics[0];
		expect(duplicate).toMatchObject({ code: "unsupported-option-value", message: "Duplicate option value" });
		const invalid = resolve(field("string"), [{ value: Number.NaN, title: "bad" }]).diagnostics[0];
		expect(invalid).toMatchObject({ code: "unsupported-option-value", message: "Unsupported option value" });
	});
});
