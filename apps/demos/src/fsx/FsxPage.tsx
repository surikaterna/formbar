import { PlaygroundHeader } from "../playground/PlaygroundShell";
import { FsxEditor } from "./FsxEditor";
import type { FsxExample } from "./registry";

export function FsxPage(props: {
	readonly demoId: string;
	readonly example: FsxExample;
	readonly demo?: boolean;
	readonly onSelect?: (id: string) => void;
	readonly onClose?: () => void;
}) {
	const Page = props.demo ? "div" : "main";
	return (
		<Page className="fsx-page min-h-screen min-w-0 bg-background">
			{props.onSelect && props.onClose ? (
				<PlaygroundHeader
					demoId={props.demoId}
					onDemoChange={props.onSelect}
					onClose={props.onClose}
					description="Experimental FSX · fsx-v1-experimental"
				/>
			) : (
				<h1 className="p-4 text-2xl font-bold">{props.example.title} — Experimental FSX</h1>
			)}
			<p className="border-b px-4 py-3 text-sm">
				FSX source is not JavaScript. Fixed app-owned schemas and installed permissions; JSON is data, not authority.
			</p>
			<FsxEditor key={props.example.id} example={props.example} demo={props.demo ?? false} />
		</Page>
	);
}
