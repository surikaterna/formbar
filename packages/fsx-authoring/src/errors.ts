import type { FsxDiagnostic, SourceRange } from "./types.js";

export class FsxError extends Error {
	constructor(readonly diagnostic: FsxDiagnostic) {
		super(diagnostic.message);
	}
}
export function fail(code: string, path: string, range?: SourceRange, message = code): never {
	throw new FsxError({
		code,
		path,
		message: `${message}; re-author using fsx-v1-experimental`,
		...(range ? { range } : {}),
	});
}
