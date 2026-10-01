export function runScaling(rows: number, outputs?: boolean): void;
export function runFocus(options?: {
	nested?: boolean;
	duplicate?: boolean;
	values?: string[];
	append?: boolean;
	disabled?: boolean;
}): Promise<void>;
export function runDuplicateFocus(): Promise<void>;
export function runLateFocus(mode: "unmount" | "dispose" | "stale"): Promise<void>;
export function runMissingViewKeys(): void;
export function runNestedDuplicateFocus(): Promise<void>;
