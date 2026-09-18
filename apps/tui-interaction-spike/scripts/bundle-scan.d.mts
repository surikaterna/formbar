export interface BundleScanReport {
	readonly files: readonly string[];
	readonly rawBytes: number;
	readonly gzipBytes: number;
	readonly findings: readonly string[];
}

export function scanBundle(root: string, gzipLimit?: number): BundleScanReport;
