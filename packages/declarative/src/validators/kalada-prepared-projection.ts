import type { JsonValue } from "@formbar/expressions";
import type { ArrayActionHost407, TrustedAction407 } from "./kalada-action-contract-407.js";
import type { EnumeratedRow, LifecycleFrame, ReadScope } from "./kalada-data-strategy.js";
import { type RecordValue, object } from "./kalada-definition-shape.js";
import type { OperationFence } from "./kalada-operation-fence.js";
import { prepareAction } from "./kalada-prepared-action.js";
import type { PreparedKaladaV1Definition } from "./kalada-prepared-definition.js";
import { nodeAt } from "./kalada-prepared-node.js";
import {
	type FrameReader,
	type Guard,
	type PreparedControl,
	type PreparedNodeView,
	type PreparedOutput,
	type PreparedRowView,
	type Writer,
	checked,
	children,
	customProps,
	flags,
	lifecycleField,
	literalProps,
	nodeId,
	scopedBlur,
} from "./kalada-prepared-view.js";
import type { createPrivateKaladaRuntimeFromPrepared } from "./kalada-private-runtime.js";
import { ProgramAdmissionError } from "./kalada-program.js";
import { resolveValidationFeedback } from "./kalada-validation-feedback.js";
import { staticDependencyKey } from "./static-references.js";

type Runtime = ReturnType<typeof createPrivateKaladaRuntimeFromPrepared>;
export interface Projection {
	readonly prepared: PreparedKaladaV1Definition;
	readonly runtime: Runtime;
	readonly frame: FrameReader;
	readonly revision: object;
	readonly key: (token: object) => string;
	readonly controls: PreparedControl[];
	readonly outputs: PreparedOutput[];
	readonly rows: PreparedRowView[];
	readonly lifecycle?: LifecycleFrame;
	readonly installed: Installed;
	readonly scoped: boolean;
	readonly register: (dispose: () => void, retire: () => void) => void;
	readonly trackOperation: (cancel: () => void) => () => void;
	readonly validate: (operation: OperationFence) => Promise<{ readonly ok: boolean; readonly code?: string }>;
	readonly rowTokens: Map<string, EnumeratedRow>;
	readonly actions: Map<string, NonNullable<PreparedNodeView["action"]>>;
	readonly submit: (operation?: OperationFence) => Promise<{
		readonly status: "submitted" | "denied" | "stale" | "missing" | "conflict" | "unsupported";
	}>;
}
export interface Installed {
	readonly widgets?: ReadonlySet<string>;
	readonly renderers?: ReadonlySet<string>;
	readonly arrayHost?: ArrayActionHost407;
	readonly actions?: Readonly<Record<string, TrustedAction407>>;
}
interface Walk {
	readonly scope: ReadScope;
	readonly row?: EnumeratedRow;
	readonly parent: { readonly visible: boolean; readonly disabled: boolean; readonly readOnly: boolean };
	readonly guards: readonly Guard[];
	readonly key: string;
}

function gateWriter(context: Projection, path: string, walk: Walk, guards: readonly Guard[]): Writer {
	const source = context.prepared.writeSources[path];
	if (typeof source !== "string") throw new ProgramAdmissionError(path, "MISSING_WRITER");
	const bound = walk.row
		? context.runtime.bindRowWrite(path, source, walk.row)
		: context.runtime.bindDirectWrite(path, source);
	if (!bound || context.frame.revision() !== context.revision) throw new ProgramAdmissionError(path, "STALE_WRITER");
	return (value) => {
		try {
			if (context.runtime.currentRevision() !== context.revision) return { status: "stale" };
			let parent = { visible: true, disabled: false, readOnly: false };
			for (const guard of guards) {
				const node = nodeAt(context.prepared.definition, guard.path);
				parent = flags(node, guard.path, guard.scope, context.runtime, parent);
				if (!parent.visible || parent.disabled || parent.readOnly) return { status: "denied" };
			}
			if (context.runtime.currentRevision() !== context.revision) return { status: "stale" };
			const result = bound(value);
			if (result.status !== "applied") return result;
			if (!context.scoped) return result;
			const revision = context.runtime.currentRevision();
			if (!revision) return { status: "stale" };
			return context.runtime.notifyScoped(
				{ path: path.replace(/\.binding$|\.props\.[^.]+\.reference$/, ""), scope: walk.scope },
				"onChange",
				revision,
			);
		} catch {
			return { status: "denied" };
		}
	};
}

function field(node: RecordValue, path: string, context: Projection, walk: Walk, guards: readonly Guard[]) {
	const value = checked(context.frame.readTarget(`${path}.binding`, walk.scope));
	const state = walk.parent;
	const required =
		node.required === undefined ? false : checked(context.frame.evaluate(`${path}.required`, walk.scope));
	if (typeof required !== "boolean") throw new ProgramAdmissionError(`${path}.required`, "BOOLEAN_REQUIRED");
	const writers: Record<string, Writer> = Object.create(null);
	if (state.visible && !state.disabled && !state.readOnly)
		writers.value = gateWriter(context, `${path}.binding`, walk, guards);
	context.controls.push(
		Object.freeze({
			path,
			nodeId: nodeId(node, path),
			key: JSON.stringify([walk.key, path]),
			type: "field" as const,
			rendererId: typeof node.widget === "string" ? node.widget : "unsupported",
			...state,
			required,
			...(context.lifecycle ? { lifecycle: lifecycleField(context.lifecycle, path, walk.scope) } : {}),
			...(node.presentation ? { presentation: node.presentation as NonNullable<PreparedControl["presentation"]> } : {}),
			value,
			props: Object.freeze(literalProps(node.props, `${path}.props`)),
			writers: Object.freeze(writers),
			...scopedBlur(context.scoped, () =>
				context.runtime.notifyScoped({ path, scope: walk.scope }, "onBlur", context.revision),
			),
		}),
	);
}

function custom(node: RecordValue, path: string, context: Projection, walk: Walk, guards: readonly Guard[]) {
	const writable = !walk.parent.disabled && !walk.parent.readOnly;
	const projected = customProps(node, path, walk.scope, context.frame, context.prepared.policy, (target) =>
		writable ? gateWriter(context, target, walk, guards) : () => ({ status: "denied" }),
	);
	const lifecycle = context.lifecycle?.field({ path, scope: walk.scope });
	context.controls.push(
		Object.freeze({
			path,
			nodeId: nodeId(node, path),
			key: JSON.stringify([walk.key, path]),
			type: "custom" as const,
			rendererId: typeof node.renderer === "string" ? node.renderer : "unsupported",
			...walk.parent,
			...projected,
			...(lifecycle?.status === "found" ? { lifecycle: lifecycle.value } : {}),
			writers: writable ? projected.writers : Object.freeze({}),
			...scopedBlur(context.scoped, () =>
				context.runtime.notifyScoped({ path, scope: walk.scope }, "onBlur", context.revision),
			),
		}),
	);
}

function output(node: RecordValue, path: string, context: Projection, walk: Walk): void {
	const value = checked(context.frame.evaluate(`${path}.value`, walk.scope));
	context.outputs.push(
		Object.freeze({
			path,
			nodeId: nodeId(node, path),
			key: JSON.stringify([walk.key, path]),
			value,
			format: (node.format ?? "plain") as PreparedOutput["format"],
			...(node.presentation ? { presentation: node.presentation as PreparedOutput["presentation"] } : {}),
			...(typeof node.label === "string" ? { label: node.label } : {}),
		}),
	);
}

function visit(value: JsonValue, path: string, context: Projection, walk: Walk): PreparedNodeView | undefined {
	const node = object(value, path);
	const state = flags(node, path, walk.scope, context.frame, walk.parent);
	const guards = [...walk.guards, { path, scope: walk.scope }];
	const next = { ...walk, parent: state, guards };
	const arrayTarget = context.prepared.admitted.targets.get(
		`${path}.${node.type === "repeater" ? "binding" : "target"}`,
	);
	if (!state.visible) return undefined;
	const view = (extra: Partial<PreparedNodeView> = {}): PreparedNodeView =>
		Object.freeze({
			path,
			nodeId: nodeId(node, path),
			key: JSON.stringify([walk.key, path]),
			type: node.type as string,
			...(arrayTarget ? { arrayTarget: staticDependencyKey(arrayTarget) } : {}),
			...(typeof node.label === "string" ? { label: node.label } : {}),
			...(typeof node.title === "string" ? { title: node.title } : {}),
			...(typeof node.description === "string" ? { description: node.description } : {}),
			...(node.presentation ? { presentation: node.presentation as PreparedNodeView["presentation"] } : {}),
			...extra,
		});
	if (node.type === "field") {
		field(node, path, context, next, guards);
		return view();
	}
	if (node.type === "action") return view({ action: projectedAction(node, path, context, next) });
	if (node.type === "custom") custom(node, path, context, next, guards);
	if (node.type === "output") {
		output(node, path, context, next);
		return view();
	}
	if (node.type === "conditional") {
		return view({ children: conditional(node, path, context, next) });
	}
	if (node.type === "repeater") {
		return view({ rows: repeater(node, path, context, next) });
	}
	if (node.type === "validation") return view(validationBinding(node, path, context, walk));
	if (node.type === "tabs" || node.type === "accordion")
		return view({ items: collectionItems(node, path, context, next) });
	return view({ children: node.children === undefined ? [] : visitChildren(node, "children", path, context, next) });
}

function projectedAction(node: RecordValue, path: string, context: Projection, walk: Walk) {
	const key = JSON.stringify([walk.key, path]);
	let action = context.actions.get(key);
	if (!action) {
		action = prepareAction(
			node,
			path,
			{
				...context,
				currentRevision: context.runtime.currentRevision,
				guardReader: context.runtime,
				nodeAt: (at) => nodeAt(context.prepared.definition, at),
			},
			walk,
		);
		context.actions.set(key, action);
	}
	return action;
}

function validationBinding(node: RecordValue, path: string, context: Projection, walk: Walk) {
	const field = context.prepared.validationFields.get(path);
	if (!field) throw new ProgramAdmissionError(`${path}.binding`, "VALIDATION_FIELD_MISSING");
	return {
		validationFor: JSON.stringify([walk.key, field]),
		...(node.messages === undefined ? {} : { issues: node.messages as readonly string[] }),
	};
}

function collectionItems(node: RecordValue, path: string, context: Projection, walk: Walk) {
	const collection = node.type === "tabs" ? "tabs" : "items";
	return children(node, collection, path).map((item, index) => {
		const at = `${path}.${collection}[${index}]`;
		const entry = object(item, at);
		return {
			id: nodeId(entry, at),
			label: entry.label as string,
			children: visitChildren(entry, "children", at, context, walk),
		};
	});
}

function visitChildren(node: RecordValue, branch: string, path: string, context: Projection, walk: Walk) {
	return children(node, branch, path).flatMap((child, index) => {
		const result = visit(child, `${path}.${branch}[${index}]`, context, walk);
		return result ? [result] : [];
	});
}

function conditional(node: RecordValue, path: string, context: Projection, walk: Walk): readonly PreparedNodeView[] {
	const value = checked(context.frame.evaluate(`${path}.condition`, walk.scope));
	if (typeof value !== "boolean") throw new ProgramAdmissionError(`${path}.condition`, "BOOLEAN_REQUIRED");
	const branch = value ? "then" : "else";
	return node[branch] === undefined ? [] : visitChildren(node, branch, path, context, walk);
}

function repeater(node: RecordValue, path: string, context: Projection, walk: Walk) {
	const enumeration = context.frame.enumerateRows(path, walk.scope);
	if (!enumeration.ok) throw new ProgramAdmissionError(enumeration.path, enumeration.code);
	return enumeration.rows.map((row) => {
		const key = JSON.stringify([walk.key, path, row.scope.rows.map((binding) => context.key(binding.token))]);
		context.rows.push(Object.freeze({ path, key, order: row.order }));
		context.rowTokens.set(key, row);
		const childWalk: Walk = { ...walk, scope: row.scope, row, key };
		return { key, children: visitChildren(node, "children", path, context, childWalk) };
	});
}

export function projectSnapshot(context: Projection) {
	const { prepared, runtime, frame, revision, lifecycle } = context;
	const root = object(prepared.definition, "definition").root;
	if (root === undefined) throw new ProgramAdmissionError("root", "MISSING_ROOT");
	const tree = visit(root, "root", context, {
		scope: { rows: [] },
		parent: { visible: true, disabled: false, readOnly: false },
		guards: [],
		key: "root",
	});
	// A hidden root keeps host data intact but exposes no descendants or writers.
	const visibleTree =
		(tree &&
			(prepared.validationFields.size
				? resolveValidationFeedback(
						tree,
						context.controls,
						!!lifecycle && (lifecycle.form.submitted || (lifecycle.form.submitCount ?? 0) > 0),
					)
				: tree)) ??
		Object.freeze({
			path: "root",
			nodeId: nodeId(object(root, "root"), "root"),
			key: JSON.stringify(["root", "root"]),
			type: "group",
			children: [],
		});
	const submitted = runtime.captureSubmission();
	if (submitted.status !== "found")
		throw new ProgramAdmissionError("submission", `SUBMISSION_${submitted.status.toUpperCase()}`);
	if (submitted.request.revision !== revision || frame.revision() !== revision)
		throw new ProgramAdmissionError("root", "STALE_CAPTURE");
	return Object.freeze({
		revision,
		data: submitted.request.data,
		controls: Object.freeze(context.controls),
		outputs: Object.freeze(context.outputs),
		rows: Object.freeze(context.rows),
		tree: visibleTree,
		...(lifecycle ? { lifecycle: lifecycle.form, initial: lifecycle.initial } : {}),
	});
}
