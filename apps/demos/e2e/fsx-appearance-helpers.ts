import type { Locator } from "@playwright/test";

export async function appearance(editor: Locator) {
	return editor.evaluate((element) => {
		const root = element.closest(".cm-editor");
		if (!root) throw new Error("Missing editor root");
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Missing color conversion context");
		const rgb = (color: string) => {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
		};
		const color = (selector: string, property: "color" | "backgroundColor" | "borderLeftColor") => {
			const node = root.querySelector(selector);
			if (!node) throw new Error(`Missing ${selector}`);
			return rgb(getComputedStyle(node)[property]);
		};
		return {
			background: rgb(getComputedStyle(root).backgroundColor),
			text: rgb(getComputedStyle(element).color),
			caret: color(".cm-cursor", "borderLeftColor"),
			selection: root.querySelector(".cm-selectionBackground")
				? color(".cm-selectionBackground", "backgroundColor")
				: null,
			tag: color(".cm-fsx-tag", "color"),
			attribute: color(".cm-fsx-attribute", "color"),
			string: color(".cm-fsx-string", "color"),
			punctuation: color(".cm-fsx-punctuation", "color"),
		};
	});
}

export function contrast(first: number[], second: number[]) {
	const luminance = (color: number[]) =>
		color
			.map((value) => value / 255)
			.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
			.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
	const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
	return (values[0] + 0.05) / (values[1] + 0.05);
}
