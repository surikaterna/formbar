import { describe, expect, test } from "vitest";
import { FormbarError } from "../errors.js";
import { parsePath, toDot, toPointer } from "../path-parser.js";

function expectPath(input: string, ns: "data" | "ui", segments: readonly (string | number)[]) {
	const result = parsePath(input);
	expect(result.namespace).toBe(ns);
	expect(result.segments).toEqual(segments);
}

function expectError(input: string, code: string) {
	try {
		parsePath(input);
		throw new Error(`Expected FormbarError with code ${code}`);
	} catch (e) {
		expect(e).toBeInstanceOf(FormbarError);
		expect((e as FormbarError).code).toBe(code);
	}
}

describe("parsePath — dot paths", () => {
	test("simple single segment", () => expectPath("customer", "data", ["customer"]));
	test("nested two segments", () => expectPath("customer.email", "data", ["customer", "email"]));
	test("deep path", () => expectPath("a.b.c.d", "data", ["a", "b", "c", "d"]));
	test("numeric index 0", () => expectPath("items.0.name", "data", ["items", 0, "name"]));
	test("multi-digit numeric", () => expectPath("items.12", "data", ["items", 12]));
	test("leading zero stays string", () => expectPath("items.01", "data", ["items", "01"]));
	test("hyphen and underscore", () => expectPath("my-field.sub_field", "data", ["my-field", "sub_field"]));
});

describe("parsePath — $ui dot paths", () => {
	test("simple ui path", () => expectPath("$ui.visible", "ui", ["visible"]));
	test("nested ui path", () => expectPath("$ui.customer.email.visible", "ui", ["customer", "email", "visible"]));
	test("$ui alone rejects", () => expectError("$ui", "FORMBAR_PATH_INVALID_DOT"));
});

describe("parsePath — JSON Pointer", () => {
	test("empty pointer is the data root", () => expectPath("", "data", []));
	test("simple pointer", () => expectPath("/customer", "data", ["customer"]));
	test("nested pointer", () => expectPath("/customer/email", "data", ["customer", "email"]));
	test("escape tilde ~0", () => expectPath("/a~0b", "data", ["a~b"]));
	test("escape slash ~1", () => expectPath("/a~1b", "data", ["a/b"]));
	test("/ui/anything is data namespace", () => expectPath("/ui/anything", "data", ["ui", "anything"]));
	test("numeric segments stay as strings", () => expectPath("/items/0", "data", ["items", "0"]));
});

describe("parsePath — rejections", () => {
	test("mixed namespace $ui/", () => expectError("$ui/visible", "FORMBAR_PATH_MIXED_NAMESPACE"));
	test("trailing dot", () => expectError("a.", "FORMBAR_PATH_INVALID_DOT"));
	test("leading dot", () => expectError(".a", "FORMBAR_PATH_INVALID_DOT"));
	test("repeated dots", () => expectError("a..b", "FORMBAR_PATH_INVALID_DOT"));
	test("invalid pointer escape ~2", () => expectError("/a/b~2c", "FORMBAR_PATH_INVALID_POINTER_ESCAPE"));
	test("bare tilde at end", () => expectError("/a/b~", "FORMBAR_PATH_INVALID_POINTER_ESCAPE"));
});

describe("toPointer", () => {
	test("formats the data root as the empty pointer", () => expect(toPointer(parsePath(""))).toBe(""));
	test("simple data path", () => {
		expect(toPointer(parsePath("customer.email"))).toBe("/customer/email");
	});
	test("encodes tilde and slash", () => {
		const path = parsePath("/a~0b");
		expect(toPointer(path)).toBe("/a~0b");
	});
	test("ui namespace throws", () => {
		expect(() => toPointer(parsePath("$ui.visible"))).toThrow(FormbarError);
	});
});

describe("toDot", () => {
	test("simple data path", () => {
		expect(toDot(parsePath("customer.email"))).toBe("customer.email");
	});
	test("ui path", () => {
		expect(toDot(parsePath("$ui.visible"))).toBe("$ui.visible");
	});
	test("numeric segments", () => {
		expect(toDot(parsePath("items.0.name"))).toBe("items.0.name");
	});
	test("non-dot-safe throws", () => {
		const path = parsePath("/a~1b"); // segment contains /
		expect(() => toDot(path)).toThrow(FormbarError);
		try {
			toDot(path);
		} catch (e) {
			expect((e as FormbarError).code).toBe("FORMBAR_PATH_NOT_DOT_SAFE");
		}
	});
});

describe("parsePath caching", () => {
	test("returns cached result by reference equality", () => {
		const a = parsePath("cachedTest.field");
		const b = parsePath("cachedTest.field");
		expect(a).toBe(b);
	});
});

describe("round-trip invariants", () => {
	test("dot → toDot → parse = same", () => {
		const c = parsePath("customer.email");
		expect(parsePath(toDot(c))).toEqual(c);
	});
	test("dot → toPointer → parse = same (data)", () => {
		const c = parsePath("customer.email");
		expect(parsePath(toPointer(c))).toEqual(c);
	});
	test("pointer → toPointer → parse = same", () => {
		const c = parsePath("/customer/email");
		expect(parsePath(toPointer(c))).toEqual(c);
	});
	test("ui dot → toDot → parse = same", () => {
		const c = parsePath("$ui.customer.visible");
		expect(parsePath(toDot(c))).toEqual(c);
	});
});
