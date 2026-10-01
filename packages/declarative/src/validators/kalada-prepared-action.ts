import type { ArrayActionHost407, TrustedAction407 } from "./kalada-action-contract-407.js";
import type { EnumeratedRow, ReadScope } from "./kalada-data-strategy.js";
import type { RecordValue } from "./kalada-definition-shape.js";
import type { OperationFence } from "./kalada-operation-fence.js";
import type { PreparedKaladaV1Definition } from "./kalada-prepared-definition.js";
import type { FrameReader, Guard, PreparedNodeView } from "./kalada-prepared-view.js";
import { flags } from "./kalada-prepared-view.js";
import { installPrivateAction407 } from "./kalada-private-actions-407.js";
import { staticDependencyKey } from "./static-references.js";

interface ActionProjection {
	readonly prepared: PreparedKaladaV1Definition;
	readonly frame: FrameReader;
	readonly runtime: { capture(): FrameReader; currentRevision(): object | undefined };
	readonly guardReader: Pick<FrameReader, "evaluate">;
	readonly revision: object;
	readonly currentRevision: () => object | undefined;
	readonly installed: {
		readonly arrayHost?: ArrayActionHost407;
		readonly actions?: Readonly<Record<string, TrustedAction407>>;
	};
	readonly register: (dispose: () => void, retire: () => void) => void;
	readonly trackOperation: (cancel: () => void) => () => void;
	readonly rowTokens: Map<string, EnumeratedRow>;
	readonly submit: (operation?: OperationFence) => Promise<{
		readonly status: "submitted" | "denied" | "stale" | "missing" | "conflict" | "unsupported";
	}>;
	readonly validate: (operation: OperationFence) => Promise<{ readonly ok: boolean; readonly code?: string }>;
	readonly nodeAt: (path: string) => RecordValue;
}

function guardAction(projection: ActionProjection, guards: readonly Guard[]): boolean {
	let parent = { visible: true, disabled: false, readOnly: false };
	for (const guard of guards) {
		parent = flags(projection.nodeAt(guard.path), guard.path, guard.scope, projection.guardReader, parent);
		if (!parent.visible || parent.disabled || parent.readOnly) return false;
	}
	return true;
}

function actionLimits(path: string, projection: ActionProjection) {
	const target = projection.prepared.admitted.targets.get(`${path}.target`);
	const repeater =
		target &&
		[...projection.prepared.admitted.repeaters.keys()].find((at) => {
			const binding = projection.prepared.admitted.targets.get(`${at}.binding`);
			return binding && staticDependencyKey(binding) === staticDependencyKey(target);
		});
	return repeater ? projection.nodeAt(repeater) : undefined;
}

export function prepareAction(
	node: RecordValue,
	path: string,
	projection: ActionProjection,
	walk: { readonly scope: ReadScope; readonly row?: EnumeratedRow; readonly guards: readonly Guard[] },
): NonNullable<PreparedNodeView["action"]> {
	const name = node.action as string;
	const { prepared } = projection;
	const target = prepared.admitted.targets.get(`${path}.target`);
	const limits = actionLimits(path, projection);
	const allowed = () => guardAction(projection, walk.guards);
	const installed = installPrivateAction407({
		strategy: prepared.strategy,
		context: prepared.context,
		frame: projection.frame,
		capture: () => projection.runtime.capture(),
		scope: walk.scope,
		...(walk.row ? { row: walk.row } : {}),
		live: () => projection.currentRevision() === projection.revision,
		installationLive: () => projection.runtime.currentRevision() !== undefined,
		trackOperation: projection.trackOperation,
		allowed,
		...(projection.installed.arrayHost ? { arrayHost: projection.installed.arrayHost } : {}),
		...(projection.installed.actions ? { handlers: projection.installed.actions } : {}),
		submit: projection.submit,
		validate: projection.validate,
		declaration: {
			path,
			action: name,
			payload: node.payload !== undefined,
			...(target ? { target } : {}),
			...(typeof limits?.minItems === "number" ? { minItems: limits.minItems } : {}),
			...(typeof limits?.maxItems === "number" ? { maxItems: limits.maxItems } : {}),
			...(typeof node.concurrency === "string"
				? { concurrency: node.concurrency as "drop" | "replace" | "queue" }
				: {}),
		},
	});
	projection.register(installed.dispose, installed.retire);
	return {
		name,
		disabled: !allowed(),
		pending: installed.pending,
		invoke: (key) => installed.invoke(key ? projection.rowTokens.get(key) : undefined),
	};
}
