import type { CreateKaladaV1HostOptions, FieldNode, FormNode, JsonValue, ValidationNode } from "@formbar/declarative";
import { createKaladaSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { dataRef, literal } from "../../../apps/demos/src/demos/kalada-fixture-programs";
import type { PlaygroundDocument } from "../../../apps/demos/src/playground/contracts";
import { disposeDemoSession, installDemo } from "../../../apps/demos/src/runtime/kalada-demo-install";
import { schemaNode } from "../../../apps/demos/src/runtime/kalada-demo-schema";
import { createDemoStrategy } from "../../../apps/demos/src/runtime/kalada-demo-strategy";
import { schemaValueAllowed } from "../../../apps/demos/src/runtime/kalada-demo-value";

type Options = {
	mode?: "schema" | "demo";
	messages?: readonly string[];
	nested?: boolean;
	duplicate?: boolean;
	fieldVisible?: boolean;
	feedbackVisible?: boolean;
	independent?: boolean;
	validationFirst?: boolean;
	untouched?: boolean;
	deferred?: boolean;
};
const binding = (segments: readonly string[], scope?: string) => ({
	namespace: "data" as const,
	segments,
	...(scope ? { scope } : {}),
});
type Host = ReturnType<typeof createKaladaSchemaForm>["host"];

function documentFor(options: Options) {
	const schema = {
		type: "object",
		...(options.untouched ? { required: ["name"] } : {}),
		additionalProperties: false,
		properties: {
			name: { type: "string", minLength: 3 },
			show: { type: "boolean" },
			...(options.nested
				? {
						groups: {
							type: "array",
							items: {
								type: "object",
								properties: {
									rows: {
										type: "array",
										items: { type: "object", properties: { name: { type: "string", minLength: 3 } } },
									},
								},
							},
						},
					}
				: {}),
		},
	};
	const field: FieldNode = {
		type: "field",
		id: "name",
		label: "Name",
		widget: "text",
		...(options.untouched ? { required: literal(true) } : {}),
		binding: binding(["name"]),
		props: { description: { mode: "literal", value: "Name guidance" } },
		...(options.fieldVisible === undefined ? {} : { visible: dataRef("show") }),
	};
	const feedback: ValidationNode = {
		type: "validation",
		id: "name-feedback",
		binding: binding(["name"]),
		...(options.messages === undefined ? {} : { messages: options.messages }),
		...(options.feedbackVisible === false ? { visible: literal(false) } : {}),
	};
	const children: FormNode[] = [
		field,
		{ type: "field", id: "show", widget: "checkbox", binding: binding(["show"]) },
		feedback,
	];
	if (options.duplicate) children.push({ ...field, id: "duplicate-name" });
	if (options.nested)
		children.push({
			type: "repeater",
			id: "groups",
			scope: "group",
			binding: binding(["groups"]),
			children: [
				{
					type: "repeater",
					id: "rows",
					scope: "item",
					binding: binding(["rows"], "group"),
					children: [
						{ type: "field", id: "row-name", label: "Row name", widget: "text", binding: binding(["name"], "item") },
						{
							type: "validation",
							id: "row-feedback",
							binding: binding(["name"], "item"),
							messages: ["Correct the row name"],
						},
					],
				},
			],
		});
	if (options.validationFirst) [children[0], children[2]] = [children[2], children[0]];
	return {
		version: 2,
		schema,
		definition: { version: 1, id: "feedback", root: { type: "group", id: "root", children } },
		initialData: {
			name: options.untouched ? "" : "Ada",
			show: options.fieldVisible !== false,
			...(options.nested
				? { groups: [{ rows: [{ name: "Ada" }, { name: "Bea" }] }, { rows: [{ name: "Other" }] }] }
				: {}),
		},
	} satisfies PlaygroundDocument;
}

function fieldInventory(document: ReturnType<typeof documentFor>) {
	const fields: Record<string, readonly (string | { row: string })[]> = {};
	const refs: Record<string, ReturnType<typeof binding>> = {};
	const paths = new Map<string, { path: readonly (string | { row: string })[]; kind: "array" | "value" }>();
	const visit = (node: FormNode, at: string, scopes: Record<string, readonly (string | { row: string })[]>) => {
		const source = "binding" in node ? node.binding : undefined;
		if (source?.segments.some((part) => typeof part !== "string")) throw new TypeError("Noncanonical fixture binding");
		const ref = source
			? binding(
					source.segments.filter((part): part is string => typeof part === "string"),
					source.scope,
				)
			: undefined;
		const path = ref && [...(ref.scope ? scopes[ref.scope] : []), ...ref.segments];
		if (path) paths.set(JSON.stringify(path), { path, kind: node.type === "repeater" ? "array" : "value" });
		if (node.type === "field" && path && ref) {
			fields[at] = path;
			refs[at] = ref;
		}
		const next =
			node.type === "repeater" && path
				? { ...scopes, [String(node.scope)]: [...path, { row: String(node.scope) }] }
				: scopes;
		for (const [i, child] of ("children" in node ? (node.children ?? []) : []).entries())
			visit(child, `${at}.children[${i}]`, next);
	};
	visit(document.definition.root, "root", {});
	return { fields, refs, paths: [...paths.values()] };
}

export function feedbackFixture(options: Options = {}) {
	const document = documentFor(options);
	const inventory = fieldInventory(document);
	const validators: Array<NonNullable<CreateKaladaV1HostOptions["validators"]>[number]> = options.independent
		? [
				(data: JsonValue) =>
					data && typeof data === "object" && "name" in data && typeof data.name === "string" && data.name.length < 3
						? [{ path: ["name"], message: "Independent same-path issue", source: "extension" as const }]
						: [],
			]
		: [];
	const gate = attemptValidator(options.deferred);
	if (options.untouched || options.deferred) validators.push(gate.validate);
	if (options.mode === "demo") {
		const host = installDemo(document, undefined, ["formbar.standard.v1"], {}, undefined, { validators });
		return {
			...gate,
			host,
			queries: [] as string[],
			control: (id: string) => host.snapshot().controls.find((field) => field.nodeId === id),
			dispose: () => disposeDemoSession(host),
			capture: () => {
				throw new Error("Use schema fixture for raw host-frame tests");
			},
			refusal: (_mode: string) => {},
		};
	}
	return { ...schemaFeedback(document, inventory, validators), ...gate };
}

function attemptValidator(deferred = false) {
	let forced = false;
	let release = () => {};
	let readyResolve = () => {};
	const ready = new Promise<void>((resolve) => {
		readyResolve = resolve;
	});
	return {
		ready,
		release: () => release(),
		forceFailure(value: boolean) {
			forced = value;
		},
		validate: (_data: JsonValue) => {
			const issues = forced
				? [{ path: ["name"], message: "Current owned submit issue", source: "extension" as const }]
				: [];
			if (!deferred) return issues;
			readyResolve();
			return new Promise<typeof issues>((resolve) => {
				release = () => resolve(issues);
			});
		},
	};
}

function schemaFeedback(
	document: ReturnType<typeof documentFor>,
	inventory: ReturnType<typeof fieldInventory>,
	validators: NonNullable<CreateKaladaV1HostOptions["validators"]>,
) {
	const identity = { generation: "feedback", fingerprint: "owned" };
	let context: Parameters<CreateKaladaV1HostOptions["strategy"]["identity"]>[0] | undefined;
	let refusal = "";
	const queries: string[] = [];
	const ports = createDemoStrategy(
		identity,
		inventory.paths,
		inventory.fields,
		(ref, value) => {
			const node = schemaNode(document.schema, ref.path);
			return !!node && schemaValueAllowed(node, value);
		},
		undefined,
		{},
		undefined,
		{ schema: document.schema, definition: document.definition },
	);
	const strategy = {
		...ports.strategy,
		identity(ctx: NonNullable<typeof context>) {
			context = ctx;
			return ports.strategy.identity(ctx);
		},
		captureLifecycle(ctx: NonNullable<typeof context>) {
			if (refusal === "missing-host") return { status: "missing" as const };
			const frame = ports.strategy.captureLifecycle?.(ctx);
			if (!frame) return { status: "missing" as const };
			if ("status" in frame) return frame;
			return {
				...frame,
				field(field: Parameters<typeof frame.field>[0]) {
					queries.push(field.path);
					return refusal ? { status: refusal as "denied" | "stale" } : frame.field(field);
				},
			};
		},
	};
	const { host } = createKaladaSchemaForm(document.schema, {
		definition: document.definition,
		provider: jsonSchemaProvider(),
		side: "input",
		identity,
		strategy,
		validators,
		policy: {
			...identity,
			widgets: {},
			renderers: {},
			actions: {},
			namespaces: { data: "available" },
			schema: { side: "input", availability: "complete", paths: inventory.paths },
			ui: { availability: "complete", paths: [] },
		},
		writeSources: Object.fromEntries(Object.keys(inventory.refs).map((path) => [`${path}.binding`, "value"])),
		directLocations: Object.fromEntries(
			Object.entries(inventory.refs).map(([path, target]) => [
				`${path}.binding`,
				{
					value: { target, type: { kind: "primitive-type" as const, name: "json" as const }, writable: true as const },
				},
			]),
		),
		initialData: document.initialData as JsonValue,
	});
	return {
		host,
		queries,
		scopes() {
			if (!context) throw new Error("Missing owned context");
			const frame = ports.strategy.capture(context);
			const groups = frame.enumerateRows?.({ rows: [] }, { namespace: "data", path: ["groups"] }, "group", 256);
			if (!groups || groups.status !== "found") throw new Error("Missing owned groups");
			return groups.rows.flatMap((group) => {
				const rows = frame.enumerateRows?.(
					group.scope,
					{ namespace: "data", path: ["groups", { row: "group" }, "rows"] },
					"item",
					256,
				);
				if (!rows || rows.status !== "found") throw new Error("Missing owned rows");
				return rows.rows.map((row) => row.scope);
			});
		},
		control: (id: string) => host.snapshot().controls.find((field) => field.nodeId === id),
		capture() {
			if (!context) throw new Error("Missing owned context");
			const frame = ports.strategy.captureLifecycle?.(context);
			if (!frame || "status" in frame) throw new Error("Missing lifecycle frame");
			return frame;
		},
		refusal(mode: string) {
			refusal = mode;
		},
		dispose() {
			host.dispose();
			ports.revoke();
		},
	};
}
