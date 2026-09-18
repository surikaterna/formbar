import { useApp, useInput, useStdout } from "ink";
import { useEffect, useState } from "react";
import { FormbarTui } from "./formbar-tui.js";
import { normalizeStandaloneInput } from "./standalone-input.js";
import type { StandaloneInteraction } from "./standalone-interaction.js";
import type { StandaloneOptions } from "./standalone-types.js";

interface Props<TData, TUi> {
	readonly options: StandaloneOptions<TData, TUi>;
	readonly interaction: StandaloneInteraction;
	readonly requestExit: (reason: "ctrl-c" | "submit") => void;
}

export function StandaloneApp<TData, TUi>({ options, interaction, requestExit }: Props<TData, TUi>) {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const [width, setWidth] = useState(() => Math.max(1, stdout.columns ?? 80));
	useEffect(() => {
		const resize = () => setWidth(Math.max(1, stdout.columns ?? 80));
		stdout.on("resize", resize);
		return () => {
			stdout.off("resize", resize);
		};
	}, [stdout]);
	useInput((input, key) => {
		const normalized = normalizeStandaloneInput(input, key);
		if (!normalized) return;
		if (normalized.kind === "exit") {
			requestExit("ctrl-c");
			exit();
			return;
		}
		if (normalized.kind === "text") {
			interaction.emitText(normalized.text);
			return;
		}
		const handled = interaction.dispatch(normalized.input);
		if (!handled && normalized.textFallback) interaction.emitText(normalized.textFallback);
	});
	const onSuccess: NonNullable<typeof options.onSubmitSuccess> = (event) => {
		try {
			options.onSubmitSuccess?.(event);
		} finally {
			if (options.exitOnSubmit !== false) {
				requestExit("submit");
				exit();
			}
		}
	};
	return (
		<FormbarTui
			form={options.form}
			schema={options.schema}
			layout={options.layout ?? options.schema.layout}
			capability={interaction.capability}
			textInput={interaction.textInput}
			viewportWidth={width}
			autoFocusFirstError={options.autoFocusFirstError}
			onDiagnostic={options.onDiagnostic}
			onSubmitSuccess={onSuccess}
			onSubmitFailure={options.onSubmitFailure}
		/>
	);
}
