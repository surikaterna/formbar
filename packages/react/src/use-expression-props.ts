import type { ExpressionService, PropDefinitions, ResolvedProps } from "@formbar/expressions";
import { useMemo, useSyncExternalStore } from "react";

/** Keep definitions stable with useMemo; subscription cleanup also invalidates retained setters. */
export function useExpressionProps(service: ExpressionService, definitions: PropDefinitions): ResolvedProps {
	const binding = useMemo(() => service.resolveProps(definitions), [service, definitions]);
	return useSyncExternalStore(binding.subscribe, binding.getSnapshot, binding.getSnapshot);
}
