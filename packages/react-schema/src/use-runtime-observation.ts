import { createFormRuntime } from "@formbar/declarative";
import type {
	CreateFormRuntimeOptions,
	RuntimePort,
	RuntimeResolvedNodeState,
	RuntimeScopeInstance,
} from "@formbar/declarative";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

interface RuntimeLease {
	readonly runtime: RuntimePort;
	mounts: number;
}

export function useOwnedRuntime<TData, TUi>(options: CreateFormRuntimeOptions<TData, TUi>): RuntimePort {
	const { form, definition, baseline, repeaterBaseline } = options;
	const lease = useMemo<RuntimeLease>(
		() => ({
			runtime: createFormRuntime({
				form,
				definition,
				...(baseline ? { baseline } : {}),
				...(repeaterBaseline ? { repeaterBaseline } : {}),
			}),
			mounts: 0,
		}),
		[form, definition, baseline, repeaterBaseline],
	);
	useEffect(() => {
		lease.mounts += 1;
		return () => {
			lease.mounts -= 1;
			queueMicrotask(() => {
				if (lease.mounts === 0) lease.runtime.dispose();
			});
		};
	}, [lease]);
	return lease.runtime;
}

export function useNodeObservation(runtime: RuntimePort, instanceKey: string): RuntimeResolvedNodeState | undefined {
	const observation = useRef<ReturnType<RuntimePort["observeNode"]> | undefined>(undefined);
	const readDirect = useCallback(() => runtime.getNode(instanceKey), [runtime, instanceKey]);
	const getSnapshot = useCallback(() => observation.current?.getSnapshot() ?? readDirect(), [readDirect]);
	const subscribe = useCallback(
		(listener: () => void) => {
			const current = runtime.observeNode(instanceKey);
			observation.current = current;
			const unsubscribe = current.subscribe(listener);
			return () => {
				unsubscribe();
				if (observation.current === current) observation.current = undefined;
				current.dispose();
			};
		},
		[runtime, instanceKey],
	);
	return useSyncExternalStore(subscribe, getSnapshot, readDirect);
}

export function rootInstanceKey(nodeId: string): string {
	return runtimeInstanceKey(nodeId, []);
}

export function runtimeInstanceKey(nodeId: string, scopes: readonly RuntimeScopeInstance[]): string {
	return JSON.stringify([nodeId, scopes]);
}
