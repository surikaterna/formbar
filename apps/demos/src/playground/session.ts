import type { PlaygroundDocument, PlaygroundSources, SourceErrors } from "./contracts";
import { parseDocument, stringifyDocument } from "./document";
import { type StorageLike, loadDraft } from "./storage";

export interface PlaygroundSession {
	readonly sources: PlaygroundSources;
	readonly applied: PlaygroundDocument;
	readonly revision: number;
	readonly errors: SourceErrors;
}

export function createPlaygroundSession(document: PlaygroundDocument): PlaygroundSession {
	return { sources: stringifyDocument(document), applied: document, revision: 0, errors: {} };
}

export function restorePlaygroundSession(
	document: PlaygroundDocument,
	presetKey: string,
	storage: StorageLike,
): PlaygroundSession {
	const session = createPlaygroundSession(document);
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

export function applySources(session: PlaygroundSession): PlaygroundSession {
	const result = parseDocument(session.sources);
	if (!result.ok) return { ...session, errors: result.errors };
	return { ...session, applied: result.document, revision: session.revision + 1, errors: {} };
}

export function resetSession(session: PlaygroundSession, document: PlaygroundDocument): PlaygroundSession {
	return { sources: stringifyDocument(document), applied: document, revision: session.revision + 1, errors: {} };
}

export function resetLiveForm(session: PlaygroundSession): PlaygroundSession {
	return { ...session, revision: session.revision + 1 };
}
