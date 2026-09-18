import type { FormApi } from "@formbar/core";
import type { FormPresentation, LayoutNode } from "@formbar/from-schema";
import { Box, Text } from "ink";
import { renderCaret } from "./caret.js";
import type { TuiEditSnapshot } from "./edit-state.js";
import type { InteractionTarget } from "./interaction.js";
import type { FocusNavigationGroup } from "./navigation.js";
import type { RendererInteraction } from "./renderer-interaction.js";
import { sanitizeTerminalText } from "./terminal-text.js";
import type { TuiTheme } from "./theme.js";

export interface FormViewProps<TData, TUi> {
	readonly node: LayoutNode;
	readonly selected: InteractionTarget | undefined;
	readonly general: FocusNavigationGroup | undefined;
	readonly form: FormApi<TData, TUi>;
	readonly presentation: FormPresentation;
	readonly interaction: RendererInteraction;
	readonly theme: TuiTheme;
	readonly width: number;
}

export function LayoutView<TData, TUi>(props: FormViewProps<TData, TUi>) {
	const { node } = props;
	if (node.type === "field") return <FieldNodeView {...props} />;
	const columns = supportedColumns(node, props.width);
	const content = (
		<Box flexDirection={columns > 1 ? "row" : "column"} columnGap={2}>
			{children(props)}
		</Box>
	);
	if (node.type !== "group") return content;
	return (
		<Box flexDirection="column" marginBottom={1}>
			<GroupHeading
				title={groupTitle(node)}
				selected={props.selected?.kind === "group" && props.selected.id === node.id}
				theme={props.theme}
			/>
			{content}
		</Box>
	);
}

function children<TData, TUi>(props: FormViewProps<TData, TUi>) {
	return (props.node.children ?? []).map((child) => <LayoutView key={child.id} {...props} node={child} />);
}

function FieldNodeView<TData, TUi>(props: FormViewProps<TData, TUi>) {
	const path = props.node.path;
	if (!path) return null;
	const inGeneral = props.general?.fields.some((field) => field.path === path) ?? false;
	return (
		<Box flexDirection="column">
			{inGeneral && path === props.general?.fields[0]?.path ? <GeneralView {...props} general={props.general} /> : null}
			{!inGeneral ? <FieldView {...props} path={path} /> : null}
			{children(props)}
		</Box>
	);
}

function GeneralView<TData, TUi>(props: FormViewProps<TData, TUi> & { readonly general: FocusNavigationGroup }) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<GroupHeading
				title={props.general.label}
				selected={props.selected?.kind === "group" && props.selected.id === props.general.id}
				theme={props.theme}
			/>
			{props.general.fields.map(({ path }) => (
				<FieldView key={path} {...props} path={path} />
			))}
		</Box>
	);
}

function FieldView<TData, TUi>(props: FormViewProps<TData, TUi> & { readonly path: string }) {
	const info = props.presentation.fieldsByPath.get(props.path);
	if (!info) return null;
	const focused = props.selected?.kind === "field" && props.selected.path === props.path;
	const edit = props.interaction.getEditSnapshot();
	const editing = focused && edit.mode !== "navigation";
	const masked = props.interaction.isMasked(props.path);
	const value = fieldValue(props.form, props.interaction, props.path, masked, edit, editing);
	const issues = masked ? "" : info.issues.map(({ message }) => sanitizeTerminalText(message)).join("; ");
	return (
		<Box flexDirection="column" minWidth={24}>
			<Text>
				<Text {...(focused ? props.theme.focusMarker : {})}>{focused ? ">" : " "}</Text>{" "}
				<Text {...(focused ? props.theme.focusLabel : {})}>{sanitizeTerminalText(info.title)}</Text>
				{info.required ? <Text {...props.theme.required}> *</Text> : null}: {value}
			</Text>
			{info.metadata?.description ? (
				<Text {...props.theme.description}>{sanitizeTerminalText(info.metadata.description)}</Text>
			) : null}
			{focused && edit.error ? <Text {...props.theme.error}>{sanitizeTerminalText(edit.error)}</Text> : null}
			{issues ? <Text {...props.theme.error}>Error: {issues}</Text> : null}
		</Box>
	);
}

function fieldValue<TData, TUi>(
	form: FormApi<TData, TUi>,
	interaction: RendererInteraction,
	path: string,
	writeOnly: boolean,
	edit: TuiEditSnapshot,
	editing: boolean,
): string {
	if (editing) return renderCaret(edit.draft, edit.caret, edit.masked);
	if (writeOnly) return "[write-only]";
	const value = form.fieldDynamic(path).get();
	const optionTitle = interaction.getOptionTitle(path, value);
	if (optionTitle !== undefined) return sanitizeTerminalText(optionTitle);
	if (typeof value === "string") return sanitizeTerminalText(value);
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean") return String(value);
	if (value === null || value === undefined) return "";
	return "[unsupported value]";
}

export function SelectOverlay({
	interaction,
	theme,
}: { readonly interaction: RendererInteraction; readonly theme: TuiTheme }) {
	const state = interaction.getEditSnapshot();
	if (state.mode !== "select") return null;
	const options = interaction.getVisibleOptions();
	return (
		<Box flexDirection="column" borderStyle="round" {...theme.overlay} width={40}>
			<Text {...theme.search}>Search: {renderCaret(state.search, state.caret)}</Text>
			{options.length === 0 ? <Text {...theme.help}>No results</Text> : null}
			{options.map((option, index) => (
				<Text
					key={`${index}:${option.title}`}
					{...(option.disabled ? theme.disabledOption : index === state.optionIndex ? theme.selectedOption : {})}
				>
					{index === state.optionIndex ? ">" : " "} {sanitizeTerminalText(option.title)}
					{option.disabled ? " (disabled)" : ""}
				</Text>
			))}
		</Box>
	);
}

function GroupHeading({
	title,
	selected,
	theme,
}: { readonly title: string; readonly selected: boolean; readonly theme: TuiTheme }) {
	return (
		<Text {...theme.groupHeading}>
			<Text {...(selected ? theme.focusMarker : {})}>{selected ? ">" : " "}</Text> {sanitizeTerminalText(title)}
		</Text>
	);
}

function supportedColumns(node: LayoutNode, width: number): number {
	const requested = typeof node.props?.columns === "number" ? Math.max(1, Math.floor(node.props.columns)) : 1;
	return width >= requested * 24 + (requested - 1) * 2 ? requested : 1;
}

function groupTitle(node: LayoutNode): string {
	return typeof node.props?.title === "string" && node.props.title.length > 0 ? node.props.title : node.id;
}
