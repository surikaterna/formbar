export interface TuiTextStyle {
	readonly color?: string;
	readonly borderColor?: string;
	readonly bold?: boolean;
	readonly dimColor?: boolean;
}

export interface TuiTheme {
	readonly description: TuiTextStyle;
	readonly disabledOption: TuiTextStyle;
	readonly error: TuiTextStyle;
	readonly focusLabel: TuiTextStyle;
	readonly focusMarker: TuiTextStyle;
	readonly groupHeading: TuiTextStyle;
	readonly help: TuiTextStyle;
	readonly overlay: TuiTextStyle;
	readonly required: TuiTextStyle;
	readonly search: TuiTextStyle;
	readonly selectedOption: TuiTextStyle;
	readonly submissionPending: TuiTextStyle;
	readonly submissionSuccess: TuiTextStyle;
	readonly submissionFailure: TuiTextStyle;
	readonly issueSummary: TuiTextStyle;
	readonly issueError: TuiTextStyle;
	readonly issueWarning: TuiTextStyle;
	readonly issueInfo: TuiTextStyle;
}

export const DEFAULT_TUI_THEME: TuiTheme = Object.freeze({
	description: { color: "gray", dimColor: true },
	disabledOption: { color: "gray", dimColor: true },
	error: { color: "red" },
	focusLabel: { color: "blue", bold: true },
	focusMarker: { color: "cyan" },
	groupHeading: { color: "cyan", bold: true },
	help: { color: "gray", dimColor: true },
	overlay: { borderColor: "cyan" },
	required: { color: "yellow" },
	search: { color: "blue" },
	selectedOption: { color: "cyan", bold: true },
	submissionPending: { color: "yellow" },
	submissionSuccess: { color: "green" },
	submissionFailure: { color: "red" },
	issueSummary: { bold: true },
	issueError: { color: "red" },
	issueWarning: { color: "yellow" },
	issueInfo: { color: "blue" },
});

const NO_STYLE = Object.freeze({});

export const NO_COLOR_TUI_THEME: TuiTheme = Object.freeze({
	description: NO_STYLE,
	disabledOption: NO_STYLE,
	error: NO_STYLE,
	focusLabel: NO_STYLE,
	focusMarker: NO_STYLE,
	groupHeading: NO_STYLE,
	help: NO_STYLE,
	overlay: NO_STYLE,
	required: NO_STYLE,
	search: NO_STYLE,
	selectedOption: NO_STYLE,
	submissionPending: NO_STYLE,
	submissionSuccess: NO_STYLE,
	submissionFailure: NO_STYLE,
	issueSummary: NO_STYLE,
	issueError: NO_STYLE,
	issueWarning: NO_STYLE,
	issueInfo: NO_STYLE,
});
