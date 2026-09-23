import type { FormAction, Middleware } from "./contracts.js";
import type { FormPlugin, PluginInitContext } from "./plugin-types.js";
import type { FormState } from "./state.js";
import type { FormStore } from "./store.js";

export function validatePluginIds<TData, TUi>(plugins: readonly FormPlugin<TData, TUi>[]): void {
	const ids = new Set<string>();
	for (const plugin of plugins) {
		if (!plugin.id || ids.has(plugin.id)) throw new Error(`Plugin id must be unique: "${plugin.id}"`);
		ids.add(plugin.id);
	}
}

interface InitResources<TData, TUi> {
	readonly plugins: readonly FormPlugin<TData, TUi>[];
	readonly middlewares: readonly Middleware[];
	readonly state: FormState<TData, TUi>;
	readonly store: FormStore<TData, TUi>;
	readonly initialData: TData;
	readonly deferred: boolean;
	readonly disposers: (() => void)[];
	readonly subscriptions: (() => void)[];
	readonly initializedMiddlewares: Middleware[];
	isActive(): boolean;
	dispatch(action: FormAction): void;
}

export function initializeFormResources<TData, TUi>(resources: InitResources<TData, TUi>): void {
	for (const middleware of resources.middlewares) {
		if (!resources.isActive()) return;
		resources.initializedMiddlewares.push(middleware);
		try {
			middleware.onInit?.({ state: resources.state });
		} catch {
			// Middleware init failures are isolated, as in the eager lifecycle.
		}
	}
	for (const plugin of resources.plugins) {
		if (!resources.isActive()) return;
		if (!plugin.onInit) continue;
		const context: PluginInitContext<TData, TUi> = {
			getState: () => ({ data: resources.store.getState().data, uiState: resources.store.getState().uiState }),
			subscribe: (listener) => {
				if (!resources.isActive()) return () => {};
				const unsubscribe = resources.store.subscribe((state) =>
					listener({ data: state.data, uiState: state.uiState }),
				);
				if (resources.deferred) resources.subscriptions.push(unsubscribe);
				return unsubscribe;
			},
			dispatch: (action) => resources.dispatch({ ...action, origin: `plugin:${plugin.id}` }),
			initialData: resources.initialData,
		};
		const disposer = plugin.onInit(context);
		if (!disposer) continue;
		if (!resources.isActive()) {
			try {
				disposer();
			} catch {
				// An already disposed form still releases any late-returned resource.
			}
			return;
		}
		resources.disposers.push(disposer);
	}
}

/** Release every acquired resource even when a user disposer throws. */
export function deactivateFormResources(
	middlewares: Middleware[],
	disposers: (() => void)[],
	subscriptions: (() => void)[],
): void {
	const releases = [...disposers.splice(0).reverse(), ...subscriptions.splice(0).reverse()];
	for (const release of releases) {
		try {
			release();
		} catch {
			/* Keep releasing remaining resources. */
		}
	}
	for (const middleware of middlewares.splice(0).reverse()) {
		try {
			middleware.onDispose?.();
		} catch {
			/* Keep releasing remaining resources. */
		}
	}
}
