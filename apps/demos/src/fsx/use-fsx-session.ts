import type { KaladaV1Host } from "@formbar/declarative";
import type { FsxDiagnostic } from "@formbar/fsx-authoring";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ApplyResult, acceptFsxDocument, applyFsx, applyFsxFromHost, retireFsxDocument } from "./compile";
import type { FsxExample } from "./registry";

function useHost(report: (diagnostics: readonly FsxDiagnostic[]) => void) {
	const host = useRef<KaladaV1Host | undefined>(undefined);
	const owner = useRef(Object.freeze({})).current;
	const onHost = useCallback(
		(next: KaladaV1Host) => {
			host.current = next;
			// Recompute owned schema issues in the new installation without treating them as an Apply gate.
			void next.validate().catch((error) => {
				if (host.current === next)
					report([
						{
							code: "PREVIEW_EVALUATION_FAILED",
							path: "preview",
							message: error instanceof Error ? error.message : "Preview validation failed",
						},
					]);
			});
			return () => {
				if (host.current === next) host.current = undefined;
			};
		},
		[report],
	);
	return { host, onHost, owner };
}

function finishApply(result: ApplyResult, previous: ApplyResult, owner: object): ApplyResult {
	if (!result.ok) return result;
	try {
		acceptFsxDocument(result.document, owner);
		retireFsxDocument(previous.ok ? previous.document : undefined, owner);
		return result;
	} catch (error) {
		retireFsxDocument(result.document, owner);
		return {
			ok: false,
			diagnostics: [
				{
					code: "DEMO_DRAFT_TRANSFER_DENIED",
					path: "preview",
					message: error instanceof Error ? error.message : "Invalid draft transfer",
				},
			],
		};
	}
}

function useTransferRetirement(result: ApplyResult, owner: object) {
	const generation = useRef(0);
	useEffect(() => {
		const current = ++generation.current;
		return () =>
			queueMicrotask(() => {
				if (generation.current === current) retireFsxDocument(result.ok ? result.document : undefined, owner);
			});
	}, [result, owner]);
}

const initial = (example: FsxExample, data: string, revision: number) => ({
	result: applyFsx(example, example.source, data),
	source: example.source,
	data,
	revision,
});

function useSources(example: FsxExample) {
	const initialData = JSON.stringify(example.data, null, 2);
	const [source, setSource] = useState(example.source);
	const [data, setData] = useState(initialData);
	const draft = useRef({ source, data });
	return {
		initialData,
		source,
		data,
		draft,
		setSource: (value: string) => {
			draft.current.source = value;
			setSource(value);
		},
		setData: (value: string) => {
			draft.current.data = value;
			setData(value);
		},
	};
}

export function useFsxSession(example: FsxExample) {
	const { initialData, source, setSource, data, setData, draft } = useSources(example);
	const [applied, setApplied] = useState(() => initial(example, initialData, 1));
	const [diagnostics, setDiagnostics] = useState<readonly FsxDiagnostic[]>([]);
	const { host, onHost, owner } = useHost(setDiagnostics);
	useTransferRetirement(applied.result, owner);
	const apply = (currentSource = draft.current.source) => {
		const currentData = draft.current.data;
		const result =
			currentData === applied.data && host.current
				? applyFsxFromHost(example, currentSource, host.current)
				: applyFsx(example, currentSource, currentData);
		const ready = finishApply(result, applied.result, owner);
		if (!ready.ok) {
			setDiagnostics(ready.diagnostics);
			return;
		}
		host.current?.dispose();
		setDiagnostics([]);
		setApplied({ result: ready, source: currentSource, data: currentData, revision: applied.revision + 1 });
	};
	const reset = () => {
		retireFsxDocument(applied.result.ok ? applied.result.document : undefined, owner);
		host.current?.dispose();
		setSource(example.source);
		setData(initialData);
		setDiagnostics([]);
		setApplied(initial(example, initialData, applied.revision + 1));
	};
	return {
		source,
		setSource: (value: string) => {
			setDiagnostics([]);
			setSource(value);
		},
		data,
		setData: (value: string) => {
			setDiagnostics([]);
			setData(value);
		},
		applied,
		diagnostics,
		apply,
		reset,
		onHost,
		owner,
		dirty: source !== applied.source || data !== applied.data,
	};
}
