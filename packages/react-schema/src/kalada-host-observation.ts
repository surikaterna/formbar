import type { KaladaV1Host } from "@formbar/declarative";
import { useMemo, useSyncExternalStore } from "react";

/** Observation epochs are not write grants; metadata can publish while an owned validation frame stays current. */
export function useKaladaHostObservation(host: KaladaV1Host) {
	const observation = useMemo(() => {
		let current = { revision: host.currentRevision() };
		return {
			snapshot: () => current,
			subscribe: (notify: () => void) =>
				host.subscribe(() => {
					current = { revision: host.currentRevision() };
					notify();
				}),
		};
	}, [host]);
	return useSyncExternalStore(observation.subscribe, observation.snapshot, observation.snapshot);
}
