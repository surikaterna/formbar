import type { KaladaV1Control } from "@formbar/declarative";
import { createContext, useContext } from "react";

type Outcome = { readonly status: string };
export type LeasedWriter = (value: unknown) => Outcome & { readonly settled?: Promise<Outcome> };

/** React readiness is only a veto. Every flushed callback still invokes the original checked host channel. */
export class CommitLease {
	private active = false;
	private failed = false;
	private readonly pending: (() => void)[] = [];
	activate() {
		if (!this.failed) this.active = true;
	}
	revoke() {
		this.active = false;
	}
	fail() {
		this.failed = true;
		this.revoke();
	}
	private enqueue(run: () => Outcome): ReturnType<LeasedWriter> {
		if (!this.active || this.failed) return { status: "uncommitted" };
		let resolve: (outcome: Outcome) => void = () => {};
		const settled = new Promise<Outcome>((done) => {
			resolve = done;
		});
		this.pending.push(() => {
			if (!this.active || this.failed) {
				resolve({ status: "uncommitted" });
				return;
			}
			try {
				resolve(run());
			} catch {
				resolve({ status: "error" });
			}
		});
		// A render/lifecycle failure or cleanup can veto the staged intent before any host mutation.
		queueMicrotask(() => this.flush());
		return { status: "queued", settled };
	}
	channels(control: KaladaV1Control) {
		const blur = control.onBlur;
		return {
			writers: Object.fromEntries(
				Object.entries(control.writers).map(([key, write]) => [
					key,
					(value: unknown) => this.enqueue(() => write(value)),
				]),
			),
			...(blur ? { onBlur: () => this.enqueue(blur) } : {}),
		};
	}
	flush() {
		for (const run of this.pending.splice(0)) run();
	}
}

export class CommitLeases {
	private readonly leases = new Set<CommitLease>();
	register(lease: CommitLease) {
		this.leases.add(lease);
		return () => {
			lease.revoke();
			this.leases.delete(lease);
		};
	}
	flush() {
		for (const lease of this.leases) lease.flush();
	}
}

export const KaladaFormContext = createContext<{ prefix: string; leases: CommitLeases }>({
	prefix: "kalada",
	leases: new CommitLeases(),
});
export const useKaladaFormContext = () => useContext(KaladaFormContext);
