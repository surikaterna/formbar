import type { JsonValue } from "@formbar/expressions";
import { object } from "./kalada-definition-shape.js";
import { OperationFence } from "./kalada-operation-fence.js";
import type { PreparedKaladaV1Definition } from "./kalada-prepared-definition.js";
import { checkRenderers } from "./kalada-prepared-node.js";
import { omissionFields } from "./kalada-prepared-omission.js";
import { type Installed, type Projection, projectSnapshot } from "./kalada-prepared-projection.js";
import { createPrivateKaladaRuntimeFromPrepared } from "./kalada-private-runtime.js";
import { ProgramAdmissionError } from "./kalada-program.js";

class PreparedRuntime {
	private readonly runtime: ReturnType<typeof createPrivateKaladaRuntimeFromPrepared>;
	private readonly managers = new Set<{ dispose: () => void; retire: () => void }>();
	private readonly operations = new Set<() => void>();
	private readonly actions: Projection["actions"] = new Map();
	private actionRevision: object | undefined;
	private readonly keys = new WeakMap<object, string>();
	private nextKey = 0;
	private submitting: OperationFence | undefined;
	constructor(
		private readonly prepared: PreparedKaladaV1Definition,
		private readonly installed: Installed,
		private readonly scoped: boolean,
	) {
		checkRenderers(prepared, installed);
		this.runtime = createPrivateKaladaRuntimeFromPrepared(prepared);
	}
	private key(token: object) {
		let value = this.keys.get(token);
		if (!value) {
			value = `host-row-${++this.nextKey}`;
			this.keys.set(token, value);
		}
		return value;
	}
	private disposeManagers(retiring = false) {
		for (const manager of this.managers) retiring ? manager.retire() : manager.dispose();
		this.managers.clear();
		this.actions.clear();
	}
	private async submitOnce(operation: OperationFence) {
		if (!operation.fresh()) return { status: "stale" as const };
		const submission = object(this.prepared.definition, "definition").submission;
		const omit = submission && object(submission, "submission").hiddenValues === "omit-inactive";
		if (omit && (!this.prepared.strategy.captureLifecycle || !this.prepared.strategy.validateLifecycle))
			return { status: "denied" as const };
		let revision = this.runtime.currentRevision();
		if (!revision) return { status: "denied" as const };
		if (this.prepared.strategy.captureLifecycle) {
			const validated = await this.validate(operation, true);
			if (!validated.ok && (!omit || validated.code !== "LIFECYCLE_INVALID")) return { status: "denied" as const };
			const observed = this.runtime.lifecycle.capture();
			if (!observed.ok || (!omit && !observed.value.form.valid) || observed.value.form.validating)
				return { status: "denied" as const };
			revision = observed.value.revision;
		}
		if (!operation.fresh()) return { status: "stale" as const };
		if (!omit) return this.runtime.submit(operation);
		const frame = this.runtime.capture();
		const fields = omissionFields(frame, object(this.prepared.definition, "definition").root as JsonValue, "root", {
			rows: [],
		});
		if (frame.revision() !== revision) return { status: "denied" as const };
		const result = await this.runtime.omission.submit({ hiddenValues: "omit-inactive", fields }, revision, operation);
		return { status: result.ok ? ("submitted" as const) : ("denied" as const) };
	}
	private globalOperation() {
		return new OperationFence(
			this.prepared.strategy,
			this.prepared.context,
			this.prepared.strategy.current(this.prepared.context),
			() => this.runtime.currentRevision() !== undefined,
			() => {
				const capture = this.prepared.strategy.captureSubmission?.(this.prepared.context);
				return capture?.status === "found" && capture.instance === this.prepared.context.instance;
			},
		);
	}
	private async validate(operation: OperationFence, submissionAttempt = false) {
		if (!operation.beginValidation()) return { ok: false as const, code: "STALE_CAPTURE" as const };
		const result = await this.runtime.lifecycle.validate(operation, submissionAttempt);
		return operation.fresh() ? result : { ok: false as const, code: "STALE_CAPTURE" as const };
	}
	private async submit(supplied?: OperationFence) {
		if (!supplied && this.prepared.strategy.captureSubmission?.(this.prepared.context).status !== "found")
			return { status: "denied" as const };
		if (this.submitting && !this.submitting.signal.aborted) {
			if (supplied?.concurrency !== "replace") return { status: "denied" as const };
			this.submitting.cancel();
		}
		const operation = supplied ?? this.globalOperation();
		this.submitting = operation;
		try {
			return await this.submitOnce(operation);
		} finally {
			if (this.submitting === operation) this.submitting = undefined;
			if (!supplied) operation.dispose();
		}
	}
	private snapshot() {
		const frame = this.runtime.capture();
		const revision = frame.revision();
		if (!revision) throw new ProgramAdmissionError("root", "STALE_CAPTURE");
		// Metadata observations retain same-frame actions instead of cancelling their pending validation.
		if (revision !== this.actionRevision) {
			this.disposeManagers(true);
			this.actionRevision = revision;
		}
		const captured = this.prepared.strategy.captureLifecycle ? this.runtime.lifecycle.capture() : undefined;
		if (captured && !captured.ok) throw new ProgramAdmissionError("root", captured.code);
		if (captured?.ok && captured.value.revision !== revision) throw new ProgramAdmissionError("root", "STALE_CAPTURE");
		return projectSnapshot({
			prepared: this.prepared,
			runtime: this.runtime,
			frame,
			revision,
			key: (token) => this.key(token),
			controls: [],
			outputs: [],
			rows: [],
			installed: this.installed,
			scoped: this.scoped || !!this.prepared.strategy.notifyScopedValidation,
			actions: this.actions,
			register: (dispose, retire) => this.managers.add({ dispose, retire }),
			trackOperation: (cancel) => {
				this.operations.add(cancel);
				return () => this.operations.delete(cancel);
			},
			rowTokens: new Map(),
			submit: (operation) => this.submit(operation),
			validate: (operation) => this.validate(operation),
			...(captured?.ok ? { lifecycle: captured.value } : {}),
		});
	}
	binding() {
		return {
			subscribe: this.runtime.subscribe,
			currentRevision: this.runtime.currentRevision,
			validate: this.runtime.lifecycle.validate,
			reset: this.runtime.lifecycle.reset,
			submit: () => this.submit(),
			snapshot: () => this.snapshot(),
			dispose: () => {
				for (const cancel of this.operations) cancel();
				this.operations.clear();
				this.submitting?.cancel();
				this.disposeManagers();
				this.runtime.dispose();
			},
		};
	}
}

/** One authority frame for reads and writes; separate metadata observations cannot extend a grant. */
export function createPreparedKaladaV1Runtime(
	prepared: PreparedKaladaV1Definition,
	installed: Installed = {},
	scoped = false,
) {
	return new PreparedRuntime(prepared, installed, scoped).binding();
}
