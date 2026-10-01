import type { PlaygroundDocument, PlaygroundSources, SourceErrors } from "./contracts";
import { parseDocument, stringifyDocument } from "./document";
import { canRetainData } from "./retained-data";
import { type PlaygroundRuntimeContext, snapshotPlaygroundContext, standardPlaygroundContext } from "./runtime-context";
import { type StorageLike, loadDraft } from "./storage";

export interface PlaygroundSession {
	readonly sources: PlaygroundSources;
	readonly applied: PlaygroundDocument;
	readonly revision: number;
	readonly errors: SourceErrors;
	readonly identity: object;
	readonly runtime: PlaygroundRuntimeContext;
	readonly previewData?: PlaygroundDocument["initialData"];
}

export function createPlaygroundSession(
	document: PlaygroundDocument,
	runtime: PlaygroundRuntimeContext = standardPlaygroundContext,
): PlaygroundSession {
	return {
		sources: stringifyDocument(document),
		applied: document,
		revision: 0,
		errors: {},
		identity: {},
		runtime: snapshotPlaygroundContext(runtime),
	};
}

export function restorePlaygroundSession(
	document: PlaygroundDocument,
	presetKey: string,
	storage: StorageLike,
	runtime: PlaygroundRuntimeContext = standardPlaygroundContext,
): PlaygroundSession {
	const session = createPlaygroundSession(document, runtime);
	const draft = loadDraft(storage, presetKey);
	return draft ? { ...session, sources: draft.sources } : session;
}

export function updateSource(
	session: PlaygroundSession,
	key: keyof PlaygroundSources,
	value: string,
): PlaygroundSession {
	return { ...session, sources: { ...session.sources, [key]: value }, errors: { ...session.errors, [key]: undefined } };
}

export function applySources(
	session: PlaygroundSession,
	liveData?: PlaygroundDocument["initialData"],
): PlaygroundSession {
	const result = parseDocument(session.sources, session.runtime);
	if (!result.ok) return { ...session, errors: result.errors };
	const compatible = canRetainData(session.applied, result.document);
	const { previewData: previous, ...base } = session;
	return {
		...base,
		applied: result.document,
		revision: session.revision + 1,
		errors: {},
		...(compatible && (liveData ?? previous) ? { previewData: structuredClone(liveData ?? previous) } : {}),
	};
}

export function resetSession(session: PlaygroundSession, document: PlaygroundDocument): PlaygroundSession {
	const { previewData: _previous, ...base } = session;
	return {
		...base,
		sources: stringifyDocument(document),
		applied: document,
		revision: session.revision + 1,
		errors: {},
	};
}

export function resetLiveForm(session: PlaygroundSession): PlaygroundSession {
	const { previewData: _previous, ...base } = session;
	return { ...base, revision: session.revision + 1 };
}

/** A source callback captured before Apply or preset replacement cannot overwrite the new selection. */
export function updateCurrentSource(
	current: PlaygroundSession,
	captured: Pick<PlaygroundSession, "identity" | "revision">,
	key: keyof PlaygroundSources,
	value: string,
): PlaygroundSession {
	return current.identity === captured.identity && current.revision === captured.revision
		? updateSource(current, key, value)
		: current;
}
