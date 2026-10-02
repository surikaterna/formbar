import type { KaladaV1Host } from "@formbar/declarative";
import { useEffect, useRef, useState } from "react";
import { disposeDemoSession, installDemo, installDemoSession } from "../runtime/kalada-demo-install";
import type { SchemaFormRuntimeProps } from "./SchemaFormRuntime";

type Installed = { host?: KaladaV1Host; error?: string };
type Submit = NonNullable<SchemaFormRuntimeProps["onSubmit"]>;
export type DemoInstaller = (props: SchemaFormRuntimeProps, submit: Submit) => KaladaV1Host;

function install(
	props: SchemaFormRuntimeProps,
	submit: Submit,
	previous?: KaladaV1Host,
	installer?: DemoInstaller,
): Installed {
	try {
		if (installer) return { host: installer(props, submit) };
		return {
			host: previous
				? installDemoSession(
						props.document,
						submit,
						props.profileIds,
						previous,
						props.initialUiState,
						props.arbiterRules,
					)
				: installDemo(props.document, submit, props.profileIds, props.initialUiState, props.arbiterRules),
		};
	} catch (error) {
		return { error: error instanceof Error ? error.message : "Unknown Kalada installation error" };
	}
}

function useRetirement(installed: Installed) {
	const disposal = useRef(0);
	useEffect(() => {
		const generation = ++disposal.current;
		return () =>
			queueMicrotask(() => {
				if (disposal.current === generation && installed.host) disposeDemoSession(installed.host);
			});
	}, [installed]);
}

/** Rule plugins are allocated after commit; StrictMode replay shares the pending installation. */
export function useDemoInstallation(
	props: SchemaFormRuntimeProps,
	submit: Submit,
	installer?: DemoInstaller,
): Installed {
	const key = JSON.stringify([
		props.profileIds ?? ["formbar.standard.v1"],
		props.document,
		props.initialUiState ?? {},
		props.arbiterRules ?? null,
	]);
	const documentKey = JSON.stringify([props.document, props.initialUiState ?? {}, props.arbiterRules ?? null]);
	const applied = useRef({ key, documentKey });
	const pending = useRef<Installed | undefined>(undefined);
	const [installed, setInstalled] = useState<Installed>(() => {
		if (props.arbiterRules) return {};
		// StrictMode also replays lazy initializers; reuse the host that will receive cleanup.
		pending.current ??= install(props, submit, undefined, installer);
		return pending.current;
	});
	useEffect(() => {
		if (applied.current.key === key && (installed.host || installed.error || pending.current)) return;
		const sameDocument = applied.current.documentKey === documentKey;
		applied.current = { key, documentKey };
		const old = installed.host;
		if (old) disposeDemoSession(old);
		const next = install(props, submit, sameDocument ? old : undefined, installer);
		pending.current = next;
		setInstalled(next);
	}, [key, documentKey, installed.host, installed.error, props, submit, installer]);
	useRetirement(installed);
	return installed;
}
