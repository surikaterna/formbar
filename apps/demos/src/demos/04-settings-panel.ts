import type { FormDefinition, FormNode, ResponsiveSpan } from "@formbar/declarative";
import type { SchemaDemoFixture } from "./baseline-contracts";

function field(
	id: string,
	path: string,
	widget: string,
	label: string,
	description?: string,
	span?: ResponsiveSpan,
): FormNode {
	return {
		type: "field",
		id,
		binding: { namespace: "data", segments: [path] },
		widget,
		label,
		...(description ? { props: { description: { mode: "literal" as const, value: description } } } : {}),
		...(span ? { presentation: { span } } : {}),
	};
}

const half = { base: "full", md: 6 } as const;
const definition = {
	version: 1,
	id: "settings-panel",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "section",
				id: "notifications",
				title: "Notifications",
				children: [
					field("f-notifications", "notifications", "checkbox", "Enable Notifications", "Receive in-app notifications"),
					field("f-emailAlerts", "emailAlerts", "checkbox", "Email Alerts", "Send email for important events"),
					field(
						"f-pushNotifications",
						"pushNotifications",
						"checkbox",
						"Push Notifications",
						"Mobile push notifications",
					),
				],
			},
			{
				type: "section",
				id: "appearance",
				title: "Appearance",
				children: [
					field("f-darkMode", "darkMode", "checkbox", "Dark Mode", "Use dark color theme"),
					field("f-compactView", "compactView", "checkbox", "Compact View", "Reduce spacing in lists"),
					field("f-fontSize", "fontSize", "demo16.range", "Font Size", "Base font size in pixels"),
				],
			},
			{
				type: "section",
				id: "localization",
				title: "Localization",
				children: [
					field("f-language", "language", "select", "Language", undefined, half),
					field("f-timezone", "timezone", "select", "Time Zone", undefined, half),
				],
			},
			{
				type: "section",
				id: "data",
				title: "Data & Privacy",
				children: [
					field("f-autoSave", "autoSave", "checkbox", "Auto-Save", "Automatically save changes"),
					field(
						"f-telemetry",
						"telemetry",
						"checkbox",
						"Usage Analytics",
						"Help us improve by sharing anonymous usage data",
					),
				],
			},
		],
	},
} satisfies FormDefinition;

export const settingsPanelDemo = {
	id: "settings-panel",
	title: "4. Settings Panel",
	subtitle: "Native preferences controls",
	copy: "The original toggle-heavy settings domain grouped into Notifications, Appearance, Localization, and Data & Privacy.",
	category: "baseline",
	runtimeProfileIds: ["demo16.trusted-widgets.v1"],
	sources: [
		{
			key: "default",
			label: "Settings schema",
			schema: {
				type: "object",
				properties: {
					notifications: {
						type: "boolean",
						title: "Enable Notifications",
						description: "Receive in-app notifications",
					},
					emailAlerts: { type: "boolean", title: "Email Alerts", description: "Send email for important events" },
					pushNotifications: { type: "boolean", title: "Push Notifications", description: "Mobile push notifications" },
					darkMode: { type: "boolean", title: "Dark Mode", description: "Use dark color theme" },
					compactView: { type: "boolean", title: "Compact View", description: "Reduce spacing in lists" },
					fontSize: {
						type: "integer",
						title: "Font Size",
						minimum: 12,
						maximum: 24,
						description: "Base font size in pixels",
					},
					language: {
						type: "string",
						title: "Language",
						enum: ["English", "Spanish", "French", "German", "Japanese"],
					},
					timezone: {
						type: "string",
						title: "Time Zone",
						enum: ["UTC-8 (PST)", "UTC-5 (EST)", "UTC+0 (GMT)", "UTC+1 (CET)", "UTC+9 (JST)", "UTC+10 (AEST)"],
					},
					autoSave: { type: "boolean", title: "Auto-Save", description: "Automatically save changes" },
					telemetry: {
						type: "boolean",
						title: "Usage Analytics",
						description: "Help us improve by sharing anonymous usage data",
					},
				},
			},
			definition,
			initialData: {},
		},
	],
} as const satisfies SchemaDemoFixture;
