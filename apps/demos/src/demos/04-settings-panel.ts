import type { FormDefinition, FormNode } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(id: string, name: string, widget: string, label: string): FormNode {
	return { type: "field", id, binding: { namespace: "data", segments: [name] }, widget, label };
}

const definition = {
	version: 1,
	id: "settings-panel",
	root: {
		type: "group",
		id: "settings-root",
		children: [
			{
				type: "section",
				id: "settings-notifications",
				title: "Notifications",
				children: [
					field("settings-email-notifications", "emailNotifications", "checkbox", "Email notifications"),
					field("settings-push-notifications", "pushNotifications", "checkbox", "Push notifications"),
				],
			},
			{
				type: "section",
				id: "settings-appearance",
				title: "Appearance",
				children: [
					field("settings-theme", "theme", "select", "Theme"),
					field("settings-font-size", "fontSize", "number", "Font size"),
				],
			},
			{
				type: "section",
				id: "settings-localization",
				title: "Localization",
				children: [
					field("settings-language", "language", "select", "Language"),
					field("settings-time-zone", "timeZone", "select", "Time Zone"),
				],
			},
			{
				type: "section",
				id: "settings-privacy",
				title: "Privacy",
				children: [field("settings-analytics", "analytics", "checkbox", "Share anonymous analytics")],
			},
		],
	},
} satisfies FormDefinition;

export const settingsPanelDemo = {
	id: "settings-panel",
	title: "4. Settings",
	subtitle: "Native preferences controls",
	copy: "Schema options and bounds drive native controls; Submit and Reset use the released form lifecycle.",
	category: "baseline",
	sources: [
		{
			key: "default",
			label: "Settings schema",
			schema: {
				type: "object",
				properties: {
					emailNotifications: { type: "boolean", title: "Email notifications", default: true },
					pushNotifications: { type: "boolean", title: "Push notifications", default: false },
					theme: { title: "Theme", enum: ["System", "Light", "Dark"] },
					fontSize: { type: "integer", title: "Font size", minimum: 12, maximum: 24 },
					language: { title: "Language", enum: ["English", "French", "Japanese"] },
					timeZone: { title: "Time Zone", enum: ["UTC", "Europe/London", "Asia/Tokyo"] },
					analytics: { type: "boolean", title: "Share anonymous analytics", default: false },
				},
			},
			definition,
			initialData: {
				emailNotifications: true,
				pushNotifications: false,
				theme: "System",
				fontSize: 16,
				language: "English",
				timeZone: "UTC",
				analytics: false,
			},
		},
	],
} as const satisfies SchemaDemoFixture;
