import type { JsonValue } from "@formbar/expressions";
import { expect, it } from "vitest";
import type {
	FormbarDataStrategyV1,
	OmissionRequest,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { omissionFields } from "../../../packages/declarative/src/validators/kalada-prepared-omission.js";
import type { FrameReader } from "../../../packages/declarative/src/validators/kalada-prepared-view.js";
import { privateOmission } from "../../../packages/declarative/src/validators/kalada-private-omission.js";

const field = (id: string, extra: Record<string, unknown> = {}) => ({ type: "field", id, ...extra });
const thenKey: string = "then";
const row = { token: {}, scope: { rows: [{ name: "lines", token: {} }] }, order: 0 };

it("inventories both conditional branches and lexical rows under hidden parents without inactive evaluation", () => {
	const evaluated: string[] = [];
	const frame: FrameReader = {
		revision: () => ({}),
		readTarget: () => ({ ok: false, path: "unused", code: "DENIED" }),
		evaluate(path) {
			evaluated.push(path);
			if (path === "root.children[2].condition") return { ok: true, value: false };
			if (path === "root.children[1].visible") return { ok: true, value: false };
			throw new Error(`inactive gate evaluated: ${path}`);
		},
		enumerateRows: () => ({ ok: true, rows: [row] }),
	};
	const definition = {
		type: "group",
		id: "root",
		children: [
			field("visible"),
			{
				type: "group",
				id: "hidden",
				visible: true,
				children: [{ type: "repeater", id: "lines", children: [field("row", { visible: true })] }],
			},
			{
				type: "conditional",
				id: "switch",
				condition: true,
				[thenKey]: [field("inactive", { visible: true })],
				else: [field("active", { submitWhenHidden: "include" })],
			},
		],
	} as unknown as JsonValue;
	const fields = omissionFields(frame, definition, "root", { rows: [] });
	expect(fields.map(({ field: target, visible }) => [target.path, visible])).toEqual([
		["root.children[0]", true],
		["root.children[1].children[0].children[0]", false],
		["root.children[2].then[0]", false],
		["root.children[2].else[0]", true],
	]);
	expect(fields[1]?.field.scope).toBe(row.scope);
	expect(fields[3]?.submitWhenHidden).toBe("include");
	expect(evaluated).toEqual(["root.children[1].visible", "root.children[2].condition"]);
});

it("rejects non-boolean observations before any host omission port", async () => {
	const context = { instance: {}, policyGeneration: "1", policyFingerprint: "p" };
	const revision = {};
	let calls = 0;
	const strategy = {
		current: () => revision,
		captureOmission: () => {
			calls++;
			return { status: "denied" as const };
		},
		validateOutgoingCandidate: () => ({ status: "denied" as const }),
		submitOmission: () => ({ status: "denied" as const }),
	} as unknown as FormbarDataStrategyV1;
	const request = {
		hiddenValues: "omit-inactive",
		fields: [{ field: { path: "root", scope: { rows: [] } }, visible: "true" }],
	} as unknown as Omit<OmissionRequest, "contract" | "instance" | "revision">;
	expect(await privateOmission(strategy, context, () => true).submit(request, revision)).toEqual({
		ok: false,
		code: "STRATEGY_ERROR",
	});
	expect(calls).toBe(0);
});

it("host must reject forged, incomplete, duplicate and unowned observations rather than treating booleans as grants", async () => {
	const context = { instance: {}, policyGeneration: "1", policyFingerprint: "p" };
	const revision = {};
	const token = {};
	const owned = [
		{ field: { path: "root.a", scope: { rows: [] } }, visible: true },
		{ field: { path: "root.rows.field", scope: { rows: [{ name: "lines", token }] } }, visible: false },
	];
	let captures = 0;
	const same = (request: OmissionRequest) =>
		request.instance === context.instance &&
		request.revision === revision &&
		request.fields.length === owned.length &&
		request.fields.every(
			(entry, i) =>
				entry.field.path === owned[i]?.field.path &&
				entry.visible === owned[i]?.visible &&
				entry.field.scope.rows.length === owned[i]?.field.scope.rows.length &&
				entry.field.scope.rows.every((binding, j) => binding.token === owned[i]?.field.scope.rows[j]?.token),
		);
	const strategy = {
		current: () => revision,
		captureOmission: (_context: unknown, request: OmissionRequest) => {
			captures++;
			return same(request)
				? { status: "found" as const, instance: context.instance, revision, candidate: { a: "retained" } }
				: { status: "conflict" as const };
		},
		validateOutgoingCandidate: () => ({ status: "denied" as const }),
		submitOmission: () => ({ status: "denied" as const }),
	} as unknown as FormbarDataStrategyV1;
	const port = privateOmission(strategy, context, () => true);
	const variants = [
		[{ ...owned[0], visible: false }, owned[1]],
		[owned[0], { ...owned[1], visible: true }],
		[owned[0]],
		[...owned, owned[1]],
		[owned[0], { ...owned[1], field: { ...owned[1].field, scope: { rows: [{ name: "lines", token: {} }] } } }],
		[...owned, { field: { path: "root.unowned", scope: { rows: [] } }, visible: false }],
	];
	for (const fields of variants)
		expect(await port.submit({ hiddenValues: "omit-inactive", fields }, revision)).toEqual({
			ok: false,
			code: "OMISSION_CONFLICT",
		});
	expect(captures).toBe(variants.length);
});
