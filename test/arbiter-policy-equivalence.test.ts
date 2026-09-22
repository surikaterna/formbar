import type { ProductionRule } from "@arbitre/core";
import { createArbiterPlugin } from "@formbar/arbiter";
import { createForm } from "@formbar/core";
import type { FormPlugin } from "@formbar/core";
import { createFormRuntime, validateFormDefinition } from "@formbar/declarative";
import type { Expression, FormDefinition, FormNode, ValidatedFormDefinition } from "@formbar/declarative";
import { describe, expect, test } from "vitest";

const literal = (value: boolean | number | string): Expression => ({ kind: "literal", value });
const ref = (key: string): Expression => ({ kind: "ref", ref: { namespace: "data", segments: [key] } });
const op = (name: string, ...args: Expression[]): Expression => ({ kind: "op", op: name, args });
const binding = (key: string) => ({ namespace: "data" as const, segments: [key] });

function validate(root: FormNode): ValidatedFormDefinition {
	const candidate: FormDefinition = { version: 1, id: "arbiter-policy", root };
	const result = validateFormDefinition(candidate);
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	return result.value;
}

function equivalentDefinition(predicate: Expression): ValidatedFormDefinition {
	const governed = (id: string): FormNode => ({
		type: "field",
		id,
		binding: binding(id),
		widget: "text",
		visible: predicate,
		disabled: predicate,
		readOnly: predicate,
		required: predicate,
	});
	const arbiter: FormNode = { type: "field", id: "arbiter", binding: binding("arbiter"), widget: "text" };
	return validate({ type: "group", id: "root", children: [governed("native"), arbiter] });
}

function policy(value: boolean) {
	return {
		path: "/arbiter",
		visible: value,
		disabled: value,
		readOnly: value,
		required: value,
	};
}

function equivalenceFixture(predicate: Expression, when: ProductionRule["when"]) {
	const rule: ProductionRule = {
		name: "common-predicate",
		when,
		// biome-ignore lint/suspicious/noThenProperty: Serialized Arbitre rule stage, never a Promise-like value.
		then: [{ $set: { "$formbar.fieldPolicy.state": policy(true) } }],
		else: [{ $set: { "$formbar.fieldPolicy.state": policy(false) } }],
	};
	const form = createForm({
		initialData: { native: "", arbiter: "", status: "closed", score: 0, active: false, tick: 0 },
		plugins: [createArbiterPlugin({ rules: [rule] })],
	});
	const runtime = createFormRuntime({ form, definition: equivalentDefinition(predicate) });
	const compare = (expected: boolean) => {
		const [native, arbiter] = runtime.getSnapshot().fields;
		const select = ({ visible, disabled, readOnly, required }: typeof native) => ({
			visible,
			disabled,
			readOnly,
			required,
		});
		expect(select(native)).toEqual(select(arbiter));
		expect(select(native)).toEqual({ visible: expected, disabled: expected, readOnly: expected, required: expected });
	};
	return { form, runtime, compare };
}

describe("native and Arbiter resolved-policy equivalence", () => {
	test.each([
		["equality", op("eq", ref("status"), literal("open")), { status: "open" }, "open"],
		["inequality", op("neq", ref("status"), literal("closed")), { status: { $ne: "closed" } }, "open"],
		[
			"membership",
			op("or", op("eq", ref("status"), literal("open")), op("eq", ref("status"), literal("pending"))),
			{ status: { $in: ["open", "pending"] } },
			"pending",
		],
	] as const)("matches %s predicates", (_name, expression, when, matching) => {
		const fixture = equivalenceFixture(expression, when as ProductionRule["when"]);
		fixture.form.setValue("status", matching);
		fixture.compare(true);
		fixture.form.setValue("status", "closed");
		fixture.compare(false);
		fixture.runtime.dispose();
		fixture.form.dispose();
	});

	test("matches comparison with simple conjunction", () => {
		const expression = op("and", op("gte", ref("score"), literal(10)), op("eq", ref("active"), literal(true)));
		const fixture = equivalenceFixture(expression, { score: { $gte: 10 }, active: true });
		fixture.form.setValue("active", true);
		fixture.form.setValue("score", 10);
		fixture.compare(true);
		fixture.form.setValue("score", 0);
		fixture.compare(false);
		fixture.runtime.dispose();
		fixture.form.dispose();
	});
});

function conflictDefinition(): ValidatedFormDefinition {
	return validate({
		type: "group",
		id: "root",
		disabled: literal(true),
		readOnly: literal(true),
		children: [
			{
				type: "section",
				id: "regional",
				children: [
					{
						type: "field",
						id: "name",
						binding: binding("name"),
						widget: "text",
						label: "Layout",
						visible: literal(true),
						required: literal(true),
					},
				],
			},
		],
	});
}

function resolvedConflict(plugins: readonly FormPlugin[]) {
	const form = createForm({ initialData: { name: "", tick: 0 }, plugins });
	const runtime = createFormRuntime({
		form,
		definition: conflictDefinition(),
		baseline: [{ nodeId: "name", label: "Schema", required: true }],
	});
	form.setValue("tick", 1);
	const field = runtime.getSnapshot().fields[0];
	runtime.dispose();
	form.dispose();
	return field;
}

describe("Arbiter remains an ordered policy producer", () => {
	test("cannot weaken native, schema, layout, or another producer restrictions", () => {
		const restrictive: FormPlugin = {
			id: "restrictive",
			evaluate: () => ({
				fieldPolicy: [
					{ path: "/name", visible: false, disabled: true, readOnly: true, required: true, label: "First" },
				],
			}),
		};
		const arbiter = () =>
			createArbiterPlugin({
				rules: [
					{
						name: "permissive",
						when: {},
						// biome-ignore lint/suspicious/noThenProperty: Serialized Arbitre rule stage, never a Promise-like value.
						then: [
							{
								$set: {
									"$formbar.fieldPolicy.name": {
										path: "/name",
										visible: true,
										disabled: false,
										readOnly: false,
										required: false,
										label: "",
									},
								},
							},
						],
					},
				],
			});

		expect(resolvedConflict([restrictive, arbiter()])).toMatchObject({
			visible: false,
			disabled: true,
			readOnly: true,
			required: true,
			label: "",
		});
		expect(resolvedConflict([arbiter(), restrictive]).label).toBe("First");
	});
});
