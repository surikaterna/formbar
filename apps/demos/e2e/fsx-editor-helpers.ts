import type { Locator } from "@playwright/test";

export async function sourceText(editor: Locator) {
	await editor.press("ControlOrMeta+a");
	return editor.evaluate((element) => {
		const clipboardData = new DataTransfer();
		element.dispatchEvent(new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }));
		return clipboardData.getData("text/plain");
	});
}

export async function fillSource(editor: Locator, text: string) {
	// Native select-all and the editor's paste handler cover virtualized/offscreen lines, unlike DOM fill.
	await editor.press("ControlOrMeta+a");
	await editor.evaluate((element, text) => {
		const clipboardData = new DataTransfer();
		clipboardData.setData("text/plain", text);
		element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
	}, text);
}

export async function sourceSelection(editor: Locator) {
	return editor.evaluate((element) => {
		const selection = window.getSelection();
		const offset = (node: Node | null, position: number) => {
			let prefix = 0;
			for (const line of element.querySelectorAll(".cm-line")) {
				if (node && line.contains(node)) {
					const range = document.createRange();
					range.setStart(line, 0);
					range.setEnd(node, position);
					return prefix + range.toString().length;
				}
				prefix += (line.textContent?.length ?? 0) + 1;
			}
			return -1;
		};
		return [
			offset(selection?.anchorNode ?? null, selection?.anchorOffset ?? 0),
			offset(selection?.focusNode ?? null, selection?.focusOffset ?? 0),
		];
	});
}
