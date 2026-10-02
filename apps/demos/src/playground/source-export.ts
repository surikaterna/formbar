export async function copySource(source: string, notify: (value: string) => void) {
	try {
		await navigator.clipboard.writeText(source);
		notify("Source copied.");
	} catch {
		notify("Clipboard unavailable.");
	}
}

export function downloadJson(value: unknown, filename: string) {
	const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}
