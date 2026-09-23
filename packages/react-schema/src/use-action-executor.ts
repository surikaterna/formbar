import type { FormApi } from "@formbar/core";
import { createActionExecutor } from "@formbar/declarative";
import type { ActionExecutionState, ActionExecutor, ActionRegistration, RuntimePort } from "@formbar/declarative";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

interface ExecutorLease {
	readonly executor: ActionExecutor;
	mounts: number;
}

export function useOwnedActionExecutor(
	form: FormApi<unknown, unknown>,
	runtime: RuntimePort,
	actions?: readonly ActionRegistration[],
): ActionExecutor {
	const lease = useMemo<ExecutorLease>(
		() => ({ executor: createActionExecutor({ form, runtime, ...(actions ? { actions } : {}) }), mounts: 0 }),
		[form, runtime, actions],
	);
	useEffect(() => {
		lease.mounts += 1;
		return () => {
			lease.mounts -= 1;
			queueMicrotask(() => {
				if (lease.mounts === 0) lease.executor.dispose();
			});
		};
	}, [lease]);
	return lease.executor;
}

export function useActionObservation(executor: ActionExecutor, instanceKey: string): ActionExecutionState {
	const observation = useRef<ReturnType<ActionExecutor["observe"]> | undefined>(undefined);
	const readDirect = useCallback(() => {
		const temporary = executor.observe(instanceKey);
		const state = temporary.getSnapshot();
		temporary.dispose();
		return state;
	}, [executor, instanceKey]);
	const getSnapshot = useCallback(() => observation.current?.getSnapshot() ?? readDirect(), [readDirect]);
	const subscribe = useCallback(
		(listener: () => void) => {
			const current = executor.observe(instanceKey);
			observation.current = current;
			const unsubscribe = current.subscribe(listener);
			return () => {
				unsubscribe();
				if (observation.current === current) observation.current = undefined;
				current.dispose();
			};
		},
		[executor, instanceKey],
	);
	return useSyncExternalStore(subscribe, getSnapshot, readDirect);
}
