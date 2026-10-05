import { FsxError } from "./errors.js";
import { FsxParser } from "./parser.js";
import type { FsxDiagnostic, SourceRange } from "./types.js";

export type FsxSyntaxClass = "tag" | "attribute" | "punctuation" | "string";
export interface FsxSyntaxSpan extends SourceRange {
	readonly kind: FsxSyntaxClass;
}
export interface FsxGuestRegion extends SourceRange {
	readonly boundary: "confirmed" | "ambiguous";
}
export interface FsxSyntaxAnalysis {
	readonly complete: boolean;
	readonly spans: readonly FsxSyntaxSpan[];
	readonly guestRegions: readonly FsxGuestRegion[];
	readonly diagnostics: readonly FsxDiagnostic[];
}
/** Internal recognition observer; never influences parser decisions. */
export interface SyntaxObserver {
	span(kind: FsxSyntaxClass, start: number, end: number): void;
	guest(start: number, end: number, confirmed: boolean): void;
}

/** Syntax only, stopping at the first error. No admission or semantic authority. */
export function analyzeFsxSyntax(source: string): FsxSyntaxAnalysis {
	const spans: FsxSyntaxSpan[] = [];
	const guestRegions: FsxGuestRegion[] = [];
	const observer: SyntaxObserver = {
		span: (kind, start, end) => spans.push({ kind, start, end }),
		guest: (start, end, confirmed) => {
			guestRegions.push({ start, end, boundary: confirmed ? "confirmed" : "ambiguous" });
		},
	};
	try {
		new FsxParser(source, observer).parse();
		return { complete: true, spans, guestRegions, diagnostics: [] };
	} catch (error) {
		const diagnostic =
			error instanceof FsxError
				? error.diagnostic
				: {
						code: "SYNTAX_INPUT_INVALID",
						path: "root",
						message: "Invalid syntax input",
					};
		return { complete: false, spans, guestRegions, diagnostics: [diagnostic] };
	}
}
