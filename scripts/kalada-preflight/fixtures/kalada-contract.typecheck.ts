import type {
	KaladaDefinition,
	KaladaNode,
	KaladaProps,
	KaladaSlot,
} from "../../../packages/declarative/src/validators/kalada-definition-contract.js";
import type { KaladaReference } from "../../../packages/declarative/src/validators/kalada-program.js";

const slot = {
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value: true },
} as const satisfies KaladaSlot;
const reference = { namespace: "data", segments: ["name"] } as const;
const scopedReference: KaladaReference = { namespace: "ui", segments: ["open"], scope: "rows" };
void scopedReference;
const formReference: KaladaReference = { namespace: "form", segments: ["valid"] };
const fieldReference: KaladaReference = { namespace: "field", segments: ["field", "valid"] };
// @ts-expect-error unknown namespace cannot address state
const invalidNamespace: KaladaReference = { namespace: "other", segments: ["valid"] };
// @ts-expect-error scope is a lexical identifier, not a structured path
const invalidScope: KaladaReference & { scope: string } = { namespace: "data", segments: ["name"], scope: ["rows"] };
void invalidNamespace;
void formReference;
void fieldReference;
void invalidScope;
const props = {
	literal: { mode: "literal", value: { title: "hello" } },
	read: { mode: "read", expression: slot },
	write: { mode: "write", reference },
} as const satisfies KaladaProps;

const field = {
	type: "field",
	id: "field",
	widget: "input",
	binding: reference,
	required: slot,
	props,
} as const satisfies KaladaNode;
const output = { type: "output", id: "output", value: slot, props } as const satisfies KaladaNode;
const action = {
	type: "action",
	id: "action",
	action: "save",
	payload: slot,
	target: reference,
	props,
} as const satisfies KaladaNode;
const custom = { type: "custom", id: "custom", renderer: "card", props } as const satisfies KaladaNode;
const validation = { type: "validation", id: "validation", binding: reference } as const satisfies KaladaNode;
const tabs = {
	type: "tabs",
	id: "tabs",
	tabs: [{ id: "tab", label: "tab", children: [output] }],
} as const satisfies KaladaNode;
const accordion = {
	type: "accordion",
	id: "accordion",
	items: [{ id: "item", label: "item", children: [action, custom, validation] }],
} as const satisfies KaladaNode;
const thenKey = "then";
const conditional = {
	type: "conditional",
	id: "condition",
	condition: slot,
	[thenKey]: [tabs],
	else: [accordion],
} as const satisfies KaladaNode;
const repeater = {
	type: "repeater",
	id: "rows",
	scope: "rows",
	binding: reference,
	children: [conditional],
} as const satisfies KaladaNode;
const section = { type: "section", id: "section", children: [field, repeater] } as const satisfies KaladaNode;

export const candidate = {
	version: 1,
	id: "form",
	root: { type: "group", id: "root", visible: slot, disabled: slot, readOnly: slot, children: [section] },
	computations: [{ id: "total", target: reference, expression: slot }],
	submission: { hiddenValues: "omit-inactive" },
} as const satisfies KaladaDefinition;

// @ts-expect-error bare Kuery expressions are not programs
const legacy: KaladaSlot = { kind: "literal", value: true };
// @ts-expect-error write slots have a reference, not an expression wrapper
const oldWrite: KaladaProps = { input: { mode: "write", expression: { kind: "ref", ref: reference } } };
// @ts-expect-error a write reference cannot carry a legacy expression as well
const mixedWrite: KaladaProps = { input: { mode: "write", reference, expression: slot } };
// @ts-expect-error computed values cannot be write references
const computedWrite: KaladaProps = { input: { mode: "write", reference: slot } };
// @ts-expect-error only data state is writable
const uiWrite: KaladaProps = { input: { mode: "write", reference: { namespace: "ui", segments: [] } } };
// @ts-expect-error literal props are JSON only
const executable: KaladaProps = { input: { mode: "literal", value: () => true } };
const unsafe: KaladaNode = {
	type: "field",
	id: "bad",
	widget: "input",
	// @ts-expect-error unsafe segments are not JSON
	binding: { namespace: "data", segments: [Symbol()] },
};
