import type { Diagnostic } from "@codemirror/lint";
import type { FsxDiagnostic, FsxDiagnosticLocation } from "@formbar/fsx-authoring";

export interface SourceDiagnosticReport {
	readonly source: string;
	readonly data: string;
	readonly diagnostics: readonly FsxDiagnostic[];
}

export function sourceRange(text: string, range: FsxDiagnosticLocation["range"]) {
	if (!range) return undefined;
	const { start, end } = range;
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length)
		return undefined;
	// Never split a CRLF or surrogate pair: such offsets cannot identify the intended text.
	const splitsUnit = (offset: number) =>
		(text[offset - 1] === "\r" && text[offset] === "\n") ||
		(/[\uD800-\uDBFF]/.test(text[offset - 1] ?? "") && /[\uDC00-\uDFFF]/.test(text[offset] ?? ""));
	if (splitsUnit(start) || splitsUnit(end)) return undefined;
	const position = (offset: number) => text.slice(0, offset).replace(/\r\n/g, "\n").length;
	return { from: position(start), to: position(end) };
}

export function sourceLint(report: SourceDiagnosticReport): Diagnostic[] {
	return report.diagnostics.flatMap((diagnostic) => {
		const range = sourceLocationRange(report, diagnostic);
		return range ? [{ ...range, severity: "error" as const, message: diagnostic.message }] : [];
	});
}

export function sourceLocationRange(report: SourceDiagnosticReport | undefined, location: FsxDiagnosticLocation) {
	// Initial-data and preview failures are not FSX locations, even if they acquire a range later.
	if (!report || location.path.startsWith("initialData") || location.path.startsWith("preview")) return undefined;
	return sourceRange(report.source, location.range);
}
