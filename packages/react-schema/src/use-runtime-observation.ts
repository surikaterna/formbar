import type { RuntimePort, RuntimeResolvedNodeState, RuntimeScopeInstance } from "@formbar/declarative";
import { useCallback, useRef, useSyncExternalStore } from "react";

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
