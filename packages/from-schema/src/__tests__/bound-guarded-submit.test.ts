import { describe, expect, it, vi } from "vitest";
import { hostSchema, validationHost } from "./kalada-validation-host-408.js";

describe("#376/#408 host-owned guarded schema submission", () => {
	it("validates the actual omitted bytes after draft validation and preserves the rejected draft", async () => {
		const schema = {
			...hostSchema,
			allOf: [
				{
					if: { properties: { profile: { type: "object" } } },
					then: { properties: { profile: { required: ["name"] } } },
				},
			],
		};
		const f = validationHost(schema, { omission: "omit-inactive" });
		const before = f.host.snapshot();
		expect(await f.host.submit()).toEqual({ status: "denied" });
		expect(f.host.snapshot().data).toEqual(before.data);
		expect(f.installed.instances.values().next().value?.outgoing).toBeUndefined();
		const visible = validationHost(schema, { omission: "omit-inactive", visible: true });
		expect(await visible.host.submit()).toEqual({ status: "submitted" });
		expect(visible.installed.instances.values().next().value?.outgoing).toEqual(visible.host.snapshot().data);
		visible.host.dispose();
		f.host.dispose();
	});
	it("omits inactive field only when authorized, includes submitWhenHidden and blocks independent same-path and ancestor issues", async () => {
		for (const mode of ["omit-inactive", "include-hidden"] as const) {
			const f = validationHost(hostSchema, { omission: mode });
			const before = f.host.snapshot().data;
			expect(await f.host.submit()).toEqual({ status: "submitted" });
			expect(f.installed.instances.values().next().value?.outgoing).toMatchObject(
				mode === "include-hidden" ? { profile: { name: "original" } } : { profile: {} },
			);
			expect(f.host.snapshot().data).toEqual(before);
			f.host.dispose();
		}
		for (const path of [["profile", "name"], ["profile"]]) {
			const f = validationHost(hostSchema, {
				omission: "omit-inactive",
				validators: [() => [{ path, message: "independent", source: "extension" }]],
			});
			expect(await f.host.submit()).toEqual({ status: "denied" });
			expect(f.installed.instances.values().next().value?.outgoing).toBeUndefined();
			f.host.dispose();
		}
	});
	it("exempts only a host-attributed draft issue, never another issue at the same or ancestor path", async () => {
		for (const path of [undefined, ["profile", "name"], ["profile"]] as const) {
			const f = validationHost(hostSchema, {
				omission: "omit-inactive",
				origin: { validator: 1, source: "extension", path: ["profile", "name"], message: "hidden" },
				validators: [
					() => [{ path: ["profile", "name"], message: "hidden", source: "extension" }],
					...(path ? [() => [{ path, message: "independent", source: "extension" as const }]] : []),
				],
			});
			const before = f.host.snapshot();
			expect(await f.host.submit()).toEqual({ status: path ? "denied" : "submitted" });
			expect(f.host.snapshot().data).toEqual(before.data);
			expect(f.installed.instances.values().next().value?.outgoing).toEqual(
				path ? undefined : { ...before.data, profile: {} },
			);
			f.host.dispose();
		}
	});
	it("blocks synchronous and asynchronous FINAL-only errors without committing or changing the draft", async () => {
		for (const asynchronous of [false, true]) {
			const f = validationHost(hostSchema, {
				omission: "omit-inactive",
				validators: [
					(data) => {
						const check = () =>
							"name" in (data as { profile: object }).profile
								? []
								: [{ path: ["profile", "name"], message: "final", source: "extension" as const }];
						return asynchronous ? Promise.resolve(check()) : check();
					},
				],
			});
			const before = f.host.snapshot();
			expect(await f.host.submit()).toEqual({ status: "denied" });
			expect(f.host.snapshot().data).toEqual(before.data);
			expect(f.installed.instances.values().next().value?.outgoing).toBeUndefined();
			f.host.dispose();
		}
	});
	it("submitWhenHidden include keeps the field and refuses its invalid value", async () => {
		const f = validationHost(hostSchema, {
			omission: "include-hidden",
			origin: { validator: 1, source: "extension", path: ["profile", "name"], message: "invalid" },
			validators: [() => [{ path: ["profile", "name"], message: "invalid", source: "extension" }]],
		});
		const before = f.host.snapshot();
		expect(await f.host.submit()).toEqual({ status: "denied" });
		expect(f.host.snapshot().data).toEqual(before.data);
		expect(f.installed.instances.values().next().value?.outgoing).toBeUndefined();
		f.host.dispose();
	});
	it("rejects a mismatched host grant rather than installing validation or submission", () => {
		expect(() => validationHost(hostSchema, { denyGrant: true })).toThrow();
	});

	it("initializes defaults through the host and respects explicit caller overrides", () => {
		const schema = {
			...hostSchema,
			properties: {
				...hostSchema.properties,
				profile: {
					type: "object",
					additionalProperties: false,
					properties: { name: { type: "string", default: "schema" } },
				},
			},
		};
		for (const [initialData, expected] of [
			[undefined, "schema"],
			[{ profile: { name: "caller" } }, "caller"],
		] as const) {
			const f = validationHost(schema, initialData ? { initialData } : {});
			expect(f.host.snapshot().data).toMatchObject({ profile: { name: expected } });
			f.host.dispose();
		}
	});

	it("validates schema constraints before committing and leaves the rejected draft intact", async () => {
		const schema = {
			...hostSchema,
			properties: {
				...hostSchema.properties,
				profile: {
					type: "object",
					additionalProperties: false,
					properties: { name: { type: "string", enum: ["original"] } },
				},
			},
		};
		const f = validationHost(schema);
		const writer = f.host.snapshot().controls.find((control) => control.nodeId === f.nameId)?.writers.value;
		expect(writer?.("invalid")).toEqual({ status: "applied" });
		const before = f.host.snapshot();
		expect(await f.host.submit()).toEqual({ status: "denied" });
		expect(f.host.snapshot().data).toEqual(before.data);
		expect(f.host.snapshot().revision).toBe(before.revision);
		expect(f.host.snapshot().lifecycle?.issues.schema).not.toEqual([]);
		expect(f.installed.instances.values().next().value?.outgoing).toBeUndefined();
		f.host.dispose();
	});

	it("checks real nested row schema paths and prevents invalid outgoing bytes", async () => {
		const schema = {
			...hostSchema,
			properties: {
				...hostSchema.properties,
				rows: {
					...hostSchema.properties.rows,
					items: {
						...hostSchema.properties.rows.items,
						properties: {
							nested: {
								...hostSchema.properties.rows.items.properties.nested,
								items: {
									type: "object",
									additionalProperties: false,
									properties: { quantity: { type: "string", enum: ["child"] } },
								},
							},
						},
					},
				},
			},
		};
		const f = validationHost(schema);
		const writer = f.host.snapshot().controls.find((control) => control.nodeId === f.quantityId)?.writers.value;
		expect(writer?.("invalid")).toEqual({ status: "applied" });
		expect(await f.host.submit()).toEqual({ status: "denied" });
		expect(f.host.snapshot().lifecycle?.issues.schema).not.toEqual([]);
		expect(f.installed.instances.values().next().value?.outgoing).toBeUndefined();
		f.host.dispose();
	});

	it("commits only a validated capture and denies a duplicate in-flight submit", async () => {
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const validator = vi.fn(async () => {
			await pending;
			return [];
		});
		const f = validationHost(hostSchema, { validators: [validator] });
		const first = f.host.submit();
		expect(await f.host.submit()).toEqual({ status: "denied" });
		release();
		expect(await first).toEqual({ status: "submitted" });
		expect(validator).toHaveBeenCalled();
		expect(f.installed.instances.values().next().value?.outgoing).toEqual(f.host.snapshot().data);
		f.host.dispose();
	});

	it("fences stale async extension issues after reset and does not commit", async () => {
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const f = validationHost(hostSchema, {
			validators: [
				async () => {
					await pending;
					return [{ path: ["profile", "name"], source: "extension", message: "late" }];
				},
			],
		});
		const first = f.host.submit();
		expect(f.host.reset()).toMatchObject({ ok: true });
		const revision = f.host.snapshot().revision;
		release();
		expect(await first).toEqual({ status: "denied" });
		expect(f.host.snapshot()).toMatchObject({ revision, lifecycle: { issues: { extension: [] } } });
		expect(f.installed.instances.values().next().value?.outgoing).toBeUndefined();
		f.host.dispose();
	});
});
