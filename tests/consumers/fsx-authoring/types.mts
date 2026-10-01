import type { ValidatedFormDefinition } from "@formbar/declarative";
import { type FsxCompileOptions, type FsxCompileResult, compileFsx } from "@formbar/fsx-authoring";
export function consumer(source: string, options: FsxCompileOptions): ValidatedFormDefinition | undefined {
	const result: FsxCompileResult = compileFsx(source, options);
	return result.ok ? result.validated : undefined;
}
