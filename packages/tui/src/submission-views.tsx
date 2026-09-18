import type { SchemaFormResult } from "@formbar/from-schema";
import { Box, Text } from "ink";
import type { RendererInteraction } from "./renderer-interaction.js";
import { sanitizeTerminalText } from "./terminal-text.js";
import type { TuiTextStyle, TuiTheme } from "./theme.js";

export function SubmissionView({
	interaction,
	schema,
	theme,
}: {
	readonly interaction: RendererInteraction;
	readonly schema: SchemaFormResult;
	readonly theme: TuiTheme;
}) {
	const snapshot = interaction.getSubmissionSnapshot();
	if (snapshot.status === "idle" && snapshot.issues.length === 0 && !snapshot.callbackDiagnostic) return null;
	return (
		<Box flexDirection="column">
			{snapshot.status === "pending" ? <Text {...theme.submissionPending}>Submission: pending</Text> : null}
			{snapshot.status === "success" ? <Text {...theme.submissionSuccess}>Submission: succeeded</Text> : null}
			{snapshot.status === "failure" ? <Text {...theme.submissionFailure}>Submission: failed</Text> : null}
			{snapshot.issues.length > 0 ? <Text {...theme.issueSummary}>Issues ({snapshot.issues.length})</Text> : null}
			{snapshot.issues.map((issue, index) => (
				<Text key={`${issue.location}:${issue.owner ?? ""}:${index}`} {...issueStyle(theme, issue.severity)}>
					{issue.severity.toUpperCase()} {issueLabel(issue.owner, issue.location, schema)}:{" "}
					{issueMessage(issue, interaction)}
				</Text>
			))}
			{snapshot.callbackDiagnostic ? (
				<Text {...theme.issueError}>ERROR: {sanitizeTerminalText(snapshot.callbackDiagnostic.message)}</Text>
			) : null}
		</Box>
	);
}

function issueMessage(
	issue: ReturnType<RendererInteraction["getSubmissionSnapshot"]>["issues"][number],
	interaction: RendererInteraction,
): string {
	if (issue.owner && interaction.isMasked(issue.owner)) return "Invalid value";
	return sanitizeTerminalText(issue.message);
}

function issueLabel(
	owner: string | undefined,
	location: "field" | "form" | "unavailable",
	schema: SchemaFormResult,
): string {
	if (location === "form") return "Form";
	if (location === "unavailable" || !owner) return "Unavailable field";
	const title = schema.fields.find(({ path }) => path === owner)?.metadata?.title;
	return sanitizeTerminalText(typeof title === "string" && title.length > 0 ? title : owner);
}

function issueStyle(theme: TuiTheme, severity: "error" | "warning" | "info"): TuiTextStyle {
	if (severity === "error") return theme.issueError;
	if (severity === "warning") return theme.issueWarning;
	return theme.issueInfo;
}
