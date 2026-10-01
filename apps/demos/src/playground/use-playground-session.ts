import type { KaladaV1Host } from "@formbar/declarative";
import { useCallback, useRef, useState } from "react";
import type { PlaygroundDocument, PlaygroundExample } from "./contracts";
import { SOURCE_KEYS } from "./contracts";
import { applySources, resetSession, restorePlaygroundSession } from "./session";
import { discardDraft } from "./storage";

function liveData(host: KaladaV1Host | undefined): PlaygroundDocument["initialData"] | undefined {
	if (!host) return;
	const data = host.snapshot().data;
	return data && typeof data === "object" && !Array.isArray(data) ? data : undefined;
}

/** Selection identity/revision fences editor callbacks; runtime authority remains host-owned. */
export function usePlaygroundSession(example: PlaygroundExample) {
	const [session, setSession] = useState(() =>
		restorePlaygroundSession(example.document, example.key, window.localStorage, example.runtime),
	);
	const [status, setStatus] = useState("Interactive playground loaded.");
	const host = useRef<KaladaV1Host | undefined>(undefined);
	const onHost = useCallback((current: KaladaV1Host) => {
		host.current = current;
		return () => {
			if (host.current === current) host.current = undefined;
		};
	}, []);
	const apply = () => {
		const next = applySources(session, liveData(host.current));
		setSession((current) =>
			current.identity === session.identity && current.revision === session.revision ? next : current,
		);
		setStatus(next.revision === session.revision ? "Apply failed; review source errors." : "Document applied.");
		return SOURCE_KEYS.find((key) => next.errors[key]);
	};
	const reset = () => {
		discardDraft(window.localStorage, example.key);
		setSession((current) => resetSession(current, example.document));
		setStatus("Registry example restored.");
	};
	return { session, setSession, status, setStatus, apply, reset, onHost };
}
