import type { FormApi, ValidationIssue } from "@formbar/core";
import type { RuntimePort } from "@formbar/declarative";
import type { DescriptorDocument } from "@formbar/from-schema";

export interface RendererEnvironment {
	readonly runtime: RuntimePort;
	readonly form: FormApi<unknown, unknown>;
	readonly descriptors: DescriptorDocument;
	readonly prefix: string;
	readonly submitted: boolean;
	readonly issues: readonly ValidationIssue[];
}
