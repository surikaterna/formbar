import type { KaladaV1Host } from "@formbar/declarative";
import { useEffect } from "react";

/** This committed host channel is application metadata, never an authored JSON callback. */
export function useDemoHostChannel(host: KaladaV1Host | undefined, publish?: (host: KaladaV1Host) => () => void) {
	useEffect(() => (host ? publish?.(host) : undefined), [host, publish]);
}
