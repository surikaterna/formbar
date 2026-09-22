import type { FormApi } from "@formbar/core";
import type { RuntimePort } from "@formbar/declarative";
import type { DescriptorDocument } from "@formbar/from-schema";
import type { ExtensionRegistry } from "./extension-registry.js";
import type { RendererDiagnostic } from "./renderer-evidence.js";

export interface RendererEnvironment {
	readonly runtime: RuntimePort;
	readonly form: FormApi<unknown, unknown>;
	readonly descriptors: DescriptorDocument;
	readonly prefix: string;
	readonly submitted: boolean;
	readonly extensions: ExtensionRegistry;
	readonly extensionFailureCode?: RendererDiagnostic;
	readonly extensionFailed: (nodeId: string) => void;
	readonly extensionRecovered: (nodeId: string) => void;
}
