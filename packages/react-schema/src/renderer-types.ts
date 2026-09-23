import type { FormApi } from "@formbar/core";
import type { ActionExecutor, RuntimePort } from "@formbar/declarative";
import type { DescriptorDocument } from "@formbar/from-schema";
import type { ExtensionRegistry } from "./extension-registry.js";
import type { RendererDiagnostic } from "./renderer-evidence.js";
import type { RepeaterCoordinator, RepeaterIdentity } from "./repeater-coordinator.js";

export interface RendererEnvironment {
	readonly runtime: RuntimePort;
	readonly actions: ActionExecutor;
	readonly form: FormApi<unknown, unknown>;
	readonly descriptors: DescriptorDocument;
	readonly prefix: string;
	readonly submitted: boolean;
	readonly extensions: ExtensionRegistry;
	readonly repeaters: RepeaterCoordinator;
	readonly repeaterOwner?: RepeaterIdentity;
	readonly extensionFailureCode?: RendererDiagnostic;
	readonly extensionFailed: (nodeId: string) => void;
	readonly extensionRecovered: (nodeId: string) => void;
}
