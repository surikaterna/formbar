import type { ReactNode } from "react";
import { catalogue } from "../catalogue";
import { Button } from "../ui";
import { cn } from "../ui";

const buttonClass = "border-border bg-secondary text-secondary-foreground hover:bg-accent";

export function PlaygroundWorkspace(props: { readonly children: ReactNode; readonly className?: string }) {
	return <div className={cn("grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-2", props.className)}>{props.children}</div>;
}

export function PlaygroundHeader(props: {
	readonly demoId: string;
	readonly description: string;
	readonly onClose: () => void;
	readonly onDemoChange: (id: string) => void;
	readonly children?: ReactNode;
}) {
	return (
		<header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
			<Button className={buttonClass} onClick={props.onClose}>
				← Demo
			</Button>
			<div className="mr-auto min-w-52">
				<h1 className="font-bold">Interactive playground</h1>
				<p className="text-xs text-muted-foreground">{props.description}</p>
			</div>
			<label className="text-sm font-medium">
				Demo
				<select
					aria-label="Demo"
					data-playground-selector
					className="ml-2"
					value={props.demoId}
					onChange={(event) => props.onDemoChange(event.currentTarget.value)}
				>
					{["Numbered demos", "Other examples", "FSX (experimental)"].map((group) => (
						<optgroup key={group} label={group}>
							{catalogue
								.filter((entry) => selectorGroup(entry) === group)
								.map(({ id, title }) => (
									<option key={id} value={id}>
										{title}
									</option>
								))}
						</optgroup>
					))}
				</select>
			</label>
			{props.children}
		</header>
	);
}

function selectorGroup(entry: (typeof catalogue)[number]) {
	if (entry.kind === "fsx") return "FSX (experimental)";
	return entry.registration.number === undefined ? "Other examples" : "Numbered demos";
}

export function PlaygroundToolbar(props: {
	readonly onApply: () => void;
	readonly onReset: () => void;
	readonly onFormat?: () => void;
	readonly onCopy?: () => void;
	readonly onDownload?: () => void;
	readonly applyLabel?: string;
	readonly downloadLabel?: string;
}) {
	return (
		<div className="flex flex-wrap gap-2 border-b border-border bg-card px-4 py-2">
			<Button className="border-primary bg-primary text-primary-foreground" onClick={props.onApply}>
				{props.applyLabel ?? "Apply"}
			</Button>
			{props.onFormat ? (
				<Button className={buttonClass} onClick={props.onFormat}>
					Format active
				</Button>
			) : null}
			<Button className={buttonClass} onClick={props.onReset}>
				Reset example
			</Button>
			{props.onCopy ? (
				<Button className={buttonClass} onClick={props.onCopy}>
					Copy active
				</Button>
			) : null}
			{props.onDownload ? (
				<Button className={buttonClass} onClick={props.onDownload}>
					{props.downloadLabel ?? "Download document"}
				</Button>
			) : null}
		</div>
	);
}
