import type { FormDefinition, FormNode, JsonValue } from "@formbar/declarative";
import {
	compileDefaultKaladaV1Definition,
	createKaladaSchemaForm,
	jsonSchemaProvider,
	projectSchema,
} from "@formbar/from-schema";
import { createDemoStrategy } from "../runtime/kalada-demo-strategy";

export const nativeMatrix = [
	"text",
	"textarea",
	"number",
	"select",
	"checkbox",
	"radio",
	"date",
	"time",
	"email",
	"url",
	"tel",
	"password",
	"search",
	"formatted",
	"integer",
] as const;
const options = ["", 2, true, null];
export const nativeSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		text: { type: "string", minLength: 2, maxLength: 8, pattern: "^[a-z]*$" },
		textarea: { type: "string", minLength: 1, maxLength: 20, "x-formbar": { widget: "textarea" } },
		number: { type: "number", minimum: 1, maximum: 9 },
		select: { enum: options },
		checkbox: { type: "boolean" },
		radio: { enum: options, "x-formbar": { widget: "radio" } },
		date: { type: "string", format: "date" },
		time: { type: "string", "x-formbar": { widget: "time" } },
		email: { type: "string", format: "email" },
		url: { type: "string", format: "uri" },
		tel: { type: "string", "x-formbar": { widget: "tel" } },
		password: { type: "string", "x-formbar": { widget: "password" } },
		search: { type: "string", "x-formbar": { widget: "search" } },
		formatted: { type: "string", format: "email" },
		integer: { type: "integer" },
	},
};
const data = {
	text: "abc",
	textarea: "long",
	number: 3,
	select: "",
	checkbox: false,
	radio: 2,
	date: "2026-09-22",
	time: "12:30",
	email: "a@example.com",
	url: "https://example.com",
	tel: "123",
	password: "secret",
	search: "query",
	formatted: "formatted@example.com",
	integer: 2,
};
export const literalProp = (value: JsonValue) => ({ mode: "literal" as const, value });

function authored(): FormDefinition {
	return {
		version: 1,
		id: "native-matrix",
		root: {
			type: "group",
			id: "root",
			children: nativeMatrix.map((name) => ({
				type: "field",
				id: name,
				label: name,
				widget: name === "integer" ? "number" : name === "formatted" ? "text" : name,
				binding: { namespace: "data", segments: [name] },
				props:
					name === "select" || name === "radio"
						? { options: literalProp(options.map((value) => ({ value, title: String(value) }))) }
						: { placeholder: literalProp(`Enter ${name}`), description: literalProp(`${name} help`) },
			})),
		},
	};
}

export function nativeFixture(
	generated = false,
	extra: Record<string, ReturnType<typeof literalProp>> = {},
	field: (typeof nativeMatrix)[number] = "number",
) {
	const provider = jsonSchemaProvider();
	const schema = generated
		? {
				...nativeSchema,
				properties: Object.fromEntries(
					Object.entries(nativeSchema.properties).map(([name, value]) => [
						name,
						{
							...value,
							description: `${name} help`,
							"x-formbar": {
								...("x-formbar" in value ? value["x-formbar"] : {}),
								...(name !== "select" && name !== "radio" && name !== "checkbox"
									? { placeholder: `Enter ${name}` }
									: {}),
							},
						},
					]),
				),
			}
		: nativeSchema;
	const compiled = generated
		? compileDefaultKaladaV1Definition(projectSchema(schema, { provider, side: "input" }).descriptors)
		: authored();
	const definition = JSON.parse(JSON.stringify(compiled));
	if (!generated) {
		const index = nativeMatrix.indexOf(field);
		definition.root.children[index].props = { ...definition.root.children[index].props, ...extra };
	}
	const fields: FormNode[] = definition.root.children;
	const identity = { generation: "native-audit", fingerprint: "owned" };
	const paths = nativeMatrix.map((name) => ({ path: [name], kind: "value" as const }));
	const fieldPaths = Object.fromEntries(
		fields.map((field, index) => [`root.children[${index}]`, field.type === "field" ? field.binding.segments : []]),
	);
	const store = createDemoStrategy(
		identity,
		paths,
		fieldPaths,
		(ref, value) => allowed(String(ref.path[0]), value),
		undefined,
		{},
		undefined,
		{ definition },
	);
	const writeSources = Object.fromEntries(Object.keys(fieldPaths).map((path) => [`${path}.binding`, "value"]));
	const directLocations = Object.fromEntries(
		Object.entries(fieldPaths).map(([path, segments]) => [
			`${path}.binding`,
			{
				value: {
					target: { namespace: "data" as const, segments },
					type: { kind: "primitive-type" as const, name: "json" as const },
					writable: true as const,
				},
			},
		]),
	);
	try {
		const result = createKaladaSchemaForm(schema, {
			provider,
			side: "input",
			definition: generated ? undefined : definition,
			identity,
			strategy: store.strategy,
			writeSources,
			directLocations,
			policy: {
				...identity,
				widgets: {},
				renderers: {},
				actions: {},
				namespaces: { data: "available" },
				schema: { side: "input", availability: "complete", paths },
				ui: { availability: "complete", paths: [] },
			},
			initialData: data,
		});
		return {
			...result,
			dispose: () => {
				result.host.dispose();
				store.revoke();
			},
		};
	} catch (error) {
		store.revoke();
		throw error;
	}
}

function allowed(name: string, value: JsonValue) {
	if (value === null) return true;
	if (name === "number") return typeof value === "number" && Number.isFinite(value);
	if (name === "integer") return typeof value === "number" && Number.isSafeInteger(value);
	if (name === "checkbox") return typeof value === "boolean";
	if (name === "select" || name === "radio") return options.some((option) => Object.is(option, value));
	return typeof value === "string";
}
