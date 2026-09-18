export interface DisposalScheduler {
	requestFrame(callback: () => void): number | undefined;
	cancelFrame(handle: number): void;
	setFallback(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
	clearFallback(handle: ReturnType<typeof setTimeout>): void;
}

export interface ScheduledDisposal {
	flush(): void;
	isPending(): boolean;
}

const browserScheduler: DisposalScheduler = {
	requestFrame: (callback) =>
		typeof requestAnimationFrame === "function" ? requestAnimationFrame(callback) : undefined,
	cancelFrame: (handle) => {
		if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
	},
	setFallback: (callback, delayMs) => setTimeout(callback, delayMs),
	clearFallback: (handle) => clearTimeout(handle),
};

export function scheduleDisposal(
	dispose: () => void,
	report: (error: unknown) => void,
	scheduler: DisposalScheduler = browserScheduler,
): ScheduledDisposal {
	let pending = true;
	let frame: number | undefined;
	const handles: { fallback?: ReturnType<typeof setTimeout> } = {};
	const flush = () => {
		if (!pending) return;
		pending = false;
		if (frame !== undefined) scheduler.cancelFrame(frame);
		if (handles.fallback !== undefined) scheduler.clearFallback(handles.fallback);
		try {
			dispose();
		} catch (error) {
			report(error);
		}
	};
	handles.fallback = scheduler.setFallback(flush, 100);
	try {
		frame = scheduler.requestFrame(flush);
	} catch (error) {
		report(error);
	}
	return { flush, isPending: () => pending };
}
