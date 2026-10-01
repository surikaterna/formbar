import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

export function createDenialCheckoutTemp(remove: typeof rmSync = rmSync) {
	const dir = mkdtempSync(join(tmpdir(), "formbar-rc-deny-"));
	return {
		dir,
		async cleanup(): Promise<void> {
			// Child close is already awaited. Unlike native maxRetries, retry ENOTEMPTY only.
			for (let attempt = 0; ; attempt++) {
				try {
					remove(dir, { recursive: true, force: true, maxRetries: 0 });
					return;
				} catch (error) {
					if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOTEMPTY" || attempt === 3)
						throw error;
					await setTimeout(50 * (attempt + 1));
				}
			}
		},
	};
}
