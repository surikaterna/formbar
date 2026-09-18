import type { FormbarOption } from "@formbar/from-schema";
import type { TuiEditSnapshot } from "./edit-state.js";
import type { InteractionCleanup } from "./interaction.js";
import type { FormNavigationSession } from "./navigation-session.js";
import type { SubmissionSnapshot } from "./submission-controller.js";

export interface RendererInteraction {
	readonly session: FormNavigationSession;
	getAvailableActions(): readonly string[];
	getEditSnapshot(): TuiEditSnapshot;
	getVisibleOptions(): readonly FormbarOption[];
	isMasked(path: string): boolean;
	getOptionTitle(path: string, value: unknown): string | undefined;
	getRevision(): number;
	getSubmissionSnapshot(): SubmissionSnapshot;
	notifyFormChange(): void;
	subscribe(listener: () => void): InteractionCleanup;
	dispose(): void;
}
