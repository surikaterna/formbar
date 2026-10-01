import { compileFsx } from "@formbar/fsx-authoring";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.window.document,
	HTMLInputElement: dom.window.HTMLInputElement,
	Event: dom.window.Event,
	IS_REACT_ACT_ENVIRONMENT: true,
});
const { exercise } = await import("./fsx-case.mjs");
await exercise(compileFsx);
await exercise(compileFsx, "item", true, " item ");
await exercise(compileFsx, "product", true, "(product)");
dom.window.close();
