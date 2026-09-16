import { synchronousValue } from "./async.js";
import type { Diagnostic } from "./contracts.js";

const failed: readonly Diagnostic[] = Object.freeze([Object.freeze({ code: "adapter" })]);
const empty: readonly Diagnostic[] = Object.freeze([]);

/** Notification/cleanup failures are contained and reported without retaining host errors or secrets. */
export class CallbackBoundary {
	private diagnostics = empty;

	getDiagnostics = (): readonly Diagnostic[] => this.diagnostics;
	reportFailure(): void {
		this.diagnostics = failed;
	}

	run(callback: () => unknown): boolean {
		try {
			synchronousValue(callback());
			return true;
		} catch {
			this.reportFailure();
			return false;
		}
	}

	runAll(callbacks: Iterable<() => unknown>): boolean {
		let succeeded = true;
		for (const callback of callbacks) if (!this.run(callback)) succeeded = false;
		return succeeded;
	}
}
