import { createFormRuntime } from "@formbar/declarative";
import type { CreateFormRuntimeOptions, ResolvedNodeState, RuntimePort } from "@formbar/declarative";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

interface RuntimeLease {
	readonly runtime: RuntimePort;
	mounts: number;
}

export function useOwnedRuntime<TData, TUi>(options: CreateFormRuntimeOptions<TData, TUi>): RuntimePort {
	const { form, definition, baseline } = options;
	const lease = useMemo<RuntimeLease>(
		() => ({ runtime: createFormRuntime({ form, definition, ...(baseline ? { baseline } : {}) }), mounts: 0 }),
		[form, definition, baseline],
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

export function useNodeObservation(runtime: RuntimePort, instanceKey: string): ResolvedNodeState | undefined {
	const observation = useRef<ReturnType<RuntimePort["observeNode"]> | undefined>(undefined);
	const readDirect = useCallback(
		() => runtime.getSnapshot().nodes.find((item) => item.instance.instanceKey === instanceKey),
		[runtime, instanceKey],
	);
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
	return JSON.stringify([nodeId, []]);
}
