import { fail } from "./errors.js";
import { guestStop } from "./guest.js";
import type { Attribute, Element } from "./types.js";

export class FsxParser {
	private offset = 0;
	private nodes = 0;
	constructor(private readonly text: string) {}
	parse(): Element {
		if (this.text.length > 100000) fail("SOURCE_LIMIT", "root");
		this.space();
		const root = this.element("root", 0);
		this.space();
		if (this.offset !== this.text.length) this.error("TRAILING_SOURCE", "root");
		return root;
	}
	private error(code: string, path: string): never {
		return fail(code, path, { start: this.offset, end: Math.min(this.offset + 1, this.text.length) });
	}
	private space(): void {
		while (/\s/u.test(this.text[this.offset] ?? "") && this.offset < this.text.length) this.offset++;
	}
	private consume(marker: string, path: string): void {
		if (!this.text.startsWith(marker, this.offset)) this.error("MALFORMED_FSX", path);
		this.offset += marker.length;
	}
	private name(path: string): string {
		const match = /^[A-Za-z][A-Za-z0-9_-]*/u.exec(this.text.slice(this.offset));
		if (!match) this.error("EXPECTED_NAME", path);
		this.offset += match[0].length;
		return match[0];
	}
	private attribute(path: string, element: string): Attribute {
		const start = this.offset;
		const name = this.name(path);
		const declarationPath =
			name === "value" && ["Field", "Repeater"].includes(element)
				? `${path}.binding`
				: element === "CUSTOM" && !["id", "renderer"].includes(name)
					? `${path}.props.${name}`
					: `${path}.${name}`;
		this.space();
		this.consume("=", path);
		this.space();
		const valueStart = this.offset;
		if (this.text[this.offset] === "{") {
			const end = guestStop(this.text, this.offset, declarationPath);
			this.offset = end + 1;
			return {
				name,
				value: { kind: "guest", source: this.text.slice(valueStart + 1, end) },
				range: { start, end: this.offset },
				valueRange: { start: valueStart + 1, end },
			};
		}
		const quoted = /^"(?:[^"\\]|\\.)*"/u.exec(this.text.slice(this.offset));
		if (!quoted) this.error("EXPECTED_LITERAL_OR_GUEST", `${path}.${name}`);
		this.offset += quoted[0].length;
		try {
			const value: unknown = JSON.parse(quoted[0]);
			if (typeof value !== "string") this.error("INVALID_LITERAL", path);
			return {
				name,
				value: { kind: "literal", value },
				range: { start, end: this.offset },
				valueRange: { start: valueStart, end: this.offset },
			};
		} catch {
			return this.error("INVALID_LITERAL", `${path}.${name}`);
		}
	}
	private attributes(path: string, element: string): Map<string, Attribute> {
		const attributes = new Map<string, Attribute>();
		while (!this.text.startsWith("/>", this.offset) && this.text[this.offset] !== ">") {
			const attribute = this.attribute(path, element);
			if (attributes.has(attribute.name)) fail("DUPLICATE_ATTRIBUTE", `${path}.${attribute.name}`, attribute.range);
			attributes.set(attribute.name, attribute);
			const before = this.offset;
			this.space();
			if (before === this.offset && !/[/>]/u.test(this.text[this.offset] ?? "")) this.error("EXPECTED_SPACE", path);
		}
		return attributes;
	}
	private element(path: string, depth: number, authoringPath = path): Element {
		if (++this.nodes > 1000 || depth > 32) this.error("STRUCTURE_LIMIT", path);
		const start = this.offset;
		this.consume("<", path);
		const name = this.name(path);
		this.space();
		const attributes = this.attributes(name === "Alias" ? authoringPath : path, name);
		if (this.text.startsWith("/>", this.offset)) {
			this.offset += 2;
			return { name, authoringPath, attributes, children: [], range: { start, end: this.offset } };
		}
		this.consume(">", path);
		this.space();
		const children: Element[] = [];
		const alias = name === "Alias" ? /^(.*)\[(\d+)\]$/u.exec(path) : null;
		const collection = alias?.[1] ?? `${path}.${name === "Conditional" ? "then" : "children"}`;
		let emitted = Number(alias?.[2] ?? 0);
		while (!this.text.startsWith("</", this.offset)) {
			const child = this.element(
				`${collection}[${emitted}]`,
				depth + 1,
				`${authoringPath}.children[${children.length}]`,
			);
			children.push(child);
			emitted += declarationCount(child);
			this.space();
		}
		this.consume(`</${name}`, path);
		this.space();
		this.consume(">", path);
		return { name, authoringPath, attributes, children, range: { start, end: this.offset } };
	}
}
function declarationCount(element: Element): number {
	return element.name === "Alias" ? element.children.reduce((count, child) => count + declarationCount(child), 0) : 1;
}
