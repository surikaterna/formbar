export type Dispose = () => void;

export interface CleanupResult {
	readonly disposed: boolean;
	readonly errors: readonly unknown[];
}

export interface CleanupTransaction {
	acquire<T>(create: () => T, dispose: (resource: T) => void): T;
	add(dispose: Dispose): void;
	dispose(): CleanupResult;
	rollback(primary: unknown): never;
}

interface MountContext<TForm, TScope, TText, TInk> {
	readonly form: TForm;
	readonly scope: TScope;
	readonly textInput: TText;
	readonly ink: TInk;
}

export interface BrowserMountFactories<TForm, TScope, TText, TInk> {
	createForm(): TForm;
	disposeForm(form: TForm): void;
	createScope(form: TForm): TScope;
	disposeScope(scope: TScope): void;
	createTextInput(): TText;
	disposeTextInput(textInput: TText): void;
	acquireData(context: Omit<MountContext<TForm, TScope, TText, TInk>, "ink">): Dispose;
	acquirePaste(context: Omit<MountContext<TForm, TScope, TText, TInk>, "ink">): Dispose;
	acquireResize(context: Omit<MountContext<TForm, TScope, TText, TInk>, "ink">): Dispose;
	acquireForm(context: Omit<MountContext<TForm, TScope, TText, TInk>, "ink">): Dispose;
	renderInk(context: Omit<MountContext<TForm, TScope, TText, TInk>, "ink">): TInk;
	disposeInk(ink: TInk): void;
}

export interface BrowserMountLifecycle<TForm, TScope, TText, TInk> extends MountContext<TForm, TScope, TText, TInk> {
	dispose(): void;
}

export function acquireBrowserMount<TForm, TScope, TText, TInk>(
	factories: BrowserMountFactories<TForm, TScope, TText, TInk>,
): BrowserMountLifecycle<TForm, TScope, TText, TInk> {
	const transaction = createCleanupTransaction();
	try {
		const form = transaction.acquire(factories.createForm, factories.disposeForm);
		const scope = transaction.acquire(() => factories.createScope(form), factories.disposeScope);
		const textInput = transaction.acquire(factories.createTextInput, factories.disposeTextInput);
		const context = { form, scope, textInput };
		transaction.add(factories.acquireData(context));
		transaction.add(factories.acquirePaste(context));
		transaction.add(factories.acquireResize(context));
		transaction.add(factories.acquireForm(context));
		const ink = transaction.acquire(() => factories.renderInk(context), factories.disposeInk);
		return {
			...context,
			ink,
			dispose: () => throwCleanupResult(transaction.dispose(), "Browser mount cleanup failed"),
		};
	} catch (error) {
		return transaction.rollback(error);
	}
}

export function createCleanupTransaction(): CleanupTransaction {
	const cleanups: Dispose[] = [];
	let disposed = false;
	return {
		acquire(create, dispose) {
			if (disposed) throw new Error("Cannot acquire resource after disposal");
			const resource = create();
			cleanups.push(() => dispose(resource));
			return resource;
		},
		add(dispose) {
			if (disposed) throw new Error("Cannot register cleanup after disposal");
			cleanups.push(once(dispose));
		},
		dispose() {
			if (disposed) return { disposed: false, errors: [] };
			disposed = true;
			return { disposed: true, errors: runCleanups(cleanups) };
		},
		rollback(primary) {
			const errors = this.dispose().errors;
			if (errors.length === 0) throw primary;
			throw new AggregateError([primary, ...errors], "Acquisition failed and cleanup failed", { cause: primary });
		},
	};
}

export function notifySafely<T>(listener: ((value: T) => void) | undefined, value: T): void {
	try {
		listener?.(value);
	} catch {
		// Observability cannot own or interrupt acquired resources.
	}
}

export function disposeInkInstance(ink: { unmount(): void; cleanup(): void }): void {
	const errors: unknown[] = [];
	try {
		ink.unmount();
	} catch (error) {
		errors.push(error);
	} finally {
		try {
			ink.cleanup();
		} catch (error) {
			errors.push(error);
		}
	}
	throwCleanupErrors(errors, "Ink unmount failed", errors[0]);
}

function runCleanups(cleanups: Dispose[]): unknown[] {
	const errors: unknown[] = [];
	for (const cleanup of cleanups.reverse()) {
		try {
			cleanup();
		} catch (error) {
			errors.push(error);
		}
	}
	cleanups.length = 0;
	return errors;
}

function throwCleanupResult(result: CleanupResult, message: string): void {
	throwCleanupErrors(result.errors, message, result.errors[0]);
}

function throwCleanupErrors(errors: readonly unknown[], message: string, cause: unknown): void {
	if (errors.length === 0) return;
	if (errors.length === 1) throw errors[0];
	throw new AggregateError(errors, message, { cause });
}

function once(cleanup: Dispose): Dispose {
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		cleanup();
	};
}
