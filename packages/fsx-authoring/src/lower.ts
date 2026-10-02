import type { DefinitionProgram, FormDefinition, FormNode } from "@formbar/declarative";
import { attribute, leaf, literal, mapAttribute, permitted } from "./attributes.js";
import { custom } from "./custom.js";
import { fail } from "./errors.js";
import { direct, read, recordWriter } from "./expressions.js";
import type { Environment, WriterState } from "./expressions.js";
import { declareId } from "./ids.js";
import type { Element, FsxCompileOptions, SourceEntry } from "./types.js";

export class FsxLowerer {
	readonly map: SourceEntry[] = [];
	readonly writers: WriterState = { sources: Object.create(null), locations: Object.create(null) };
	private readonly ids: Parameters<typeof declareId>[1] = new Map();
	private readonly aliases = new Set<string>();
	constructor(private readonly options: FsxCompileOptions) {
		for (const name of [...Object.keys(options.references), ...Object.keys(options.locations)]) this.aliases.add(name);
	}
	lower(root: Element): FormDefinition {
		if (root.name !== "Form") fail("ROOT_FORM_REQUIRED", "root", root.range);
		permitted(root, ["id", "defaultLanguage"], "root");
		const id = this.id(root, "root");
		if (literal(root, "defaultLanguage", "root") !== "Kalada")
			fail("UNKNOWN_DEFAULT_LANGUAGE", "root.defaultLanguage", attribute(root, "defaultLanguage", "root").valueRange);
		this.map.push({ path: "id", range: attribute(root, "id", "root").valueRange });
		const environment = { reads: this.options.references, writes: this.options.locations };
		const children = this.children(root, "root", environment);
		const prefix = `${id.slice(0, 220)}:root`;
		let group = prefix;
		let collision = 0;
		while (this.ids.has(group)) group = `${prefix}:${++collision}`;
		this.map.push({ path: "root", range: root.range });
		return {
			version: 1,
			id,
			root: { type: "group", id: group, children },
			...(this.options.computations ? { computations: this.options.computations } : {}),
		};
	}
	private id(element: Element, path: string): string {
		const id = declareId(element, this.ids);
		mapAttribute(this.map, element, "id", `${path}.id`);
		return id;
	}
	private children(
		element: Element,
		path: string,
		environment: Environment,
		collection = "children",
		start = 0,
	): FormNode[] {
		const children: FormNode[] = [];
		for (const child of element.children) {
			if (child.name === "Alias")
				children.push(...this.alias(child, path, environment, start + children.length, collection));
			else children.push(this.node(child, `${path}.${collection}[${start + children.length}]`, environment));
		}
		return children;
	}
	private aliasName(element: Element, path: string): string {
		const name = literal(element, "as", path);
		if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(name) || this.aliases.has(name))
			fail("DUPLICATE_OR_INVALID_ALIAS", `${path}.as`, attribute(element, "as", path).valueRange);
		this.aliases.add(name);
		return name;
	}
	private alias(
		element: Element,
		path: string,
		environment: Environment,
		start: number,
		collection: string,
	): FormNode[] {
		const authoringPath = element.authoringPath;
		permitted(element, ["as", "value"], authoringPath);
		const name = this.aliasName(element, authoringPath);
		const entry = attribute(element, "value", authoringPath);
		if (entry.value.kind !== "guest") fail("GUEST_REQUIRED", `${authoringPath}.value`, entry.valueRange);
		const parsedName = entry.value.source.trim();
		const binding = Object.hasOwn(environment.reads, parsedName) ? environment.reads[parsedName] : undefined;
		if (!binding) fail("DIRECT_READ_ALIAS_REQUIRED", `${authoringPath}.value`, entry.valueRange);
		const next = {
			reads: { ...environment.reads, [name]: binding },
			writes: {
				...environment.writes,
				...(environment.writes[parsedName] ? { [name]: environment.writes[parsedName] } : {}),
			},
		};
		return this.children(element, path, next, collection, start);
	}
	private node(element: Element, path: string, environment: Environment): FormNode {
		if (!["Group", "Field", "Repeater", "Conditional", "Output", "CUSTOM"].includes(element.name))
			fail("UNKNOWN_ELEMENT", path, element.range);
		const id = this.id(element, path);
		this.map.push({ path, range: element.range });
		if (element.name === "CUSTOM")
			return { id, ...custom(element, path, this.options, environment, this.map, this.writers) };
		const common = this.common(element, path, environment);
		if (element.name === "Field") return this.field(element, path, environment, { id, ...common });
		if (element.name === "Repeater") return this.repeater(element, path, environment, { id, ...common });
		if (element.name === "Output") {
			permitted(element, ["id", "value", "label", "visible", "disabled", "readOnly"], path);
			leaf(element, path);
			return {
				type: "output",
				id,
				...common,
				value: read(attribute(element, "value", path), `${path}.value`, environment, this.map),
			};
		}
		if (element.name === "Conditional") {
			permitted(element, ["id", "condition", "visible", "disabled", "readOnly"], path);
			return {
				type: "conditional",
				id,
				...common,
				condition: read(attribute(element, "condition", path), `${path}.condition`, environment, this.map),
				// biome-ignore lint/suspicious/noThenProperty: V1 conditional branches are arrays, never thenable callbacks.
				then: this.children(element, path, environment, "then"),
			};
		}
		permitted(element, ["id", "label", "visible", "disabled", "readOnly"], path);
		return { type: "group", id, ...common, children: this.children(element, path, environment) };
	}
	private common(element: Element, path: string, environment: Environment) {
		const properties: {
			label?: string;
			visible?: DefinitionProgram;
			disabled?: DefinitionProgram;
			readOnly?: DefinitionProgram;
		} = {};
		if (element.attributes.has("label")) {
			properties.label = literal(element, "label", path);
			mapAttribute(this.map, element, "label", `${path}.label`);
		}
		for (const name of ["visible", "disabled", "readOnly"] as const) {
			const entry = element.attributes.get(name);
			if (entry) properties[name] = read(entry, `${path}.${name}`, environment, this.map);
		}
		return properties;
	}
	private field(element: Element, path: string, environment: Environment, base: { id: string }): FormNode {
		permitted(element, ["id", "value", "widget", "label", "required", "visible", "disabled", "readOnly"], path);
		leaf(element, path);
		const entry = attribute(element, "value", path);
		const binding = direct(entry, `${path}.binding`, environment, this.map);
		recordWriter(entry, `${path}.binding`, environment, this.writers);
		mapAttribute(this.map, element, "widget", `${path}.widget`);
		const required = element.attributes.get("required");
		return {
			type: "field",
			...base,
			binding,
			widget: literal(element, "widget", path),
			...(required ? { required: read(required, `${path}.required`, environment, this.map) } : {}),
		};
	}
	private repeater(element: Element, path: string, environment: Environment, base: { id: string }): FormNode {
		permitted(element, ["id", "value", "as", "label", "visible", "disabled", "readOnly"], path);
		const scope = this.aliasName(element, path);
		const entry = attribute(element, "value", path);
		const binding = direct(entry, `${path}.binding`, environment, this.map);
		const item = this.options.items?.[scope];
		if (!item || item.target.scope !== scope || item.target.segments.length)
			fail("TRUSTED_ITEM_REQUIRED", `${path}.scope`, attribute(element, "as", path).valueRange);
		const reference = { namespace: "data" as const, scope, segments: [] };
		const next = {
			reads: { ...environment.reads, [scope]: { reference, type: item.type } },
			writes: { ...environment.writes, [scope]: item },
		};
		mapAttribute(this.map, element, "as", `${path}.scope`);
		return { type: "repeater", ...base, binding, scope, children: this.children(element, path, next) };
	}
}
