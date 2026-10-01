import { FsxEditor } from "./FsxEditor";
import { fsxExamples } from "./registry";

export function FsxPage(props: {
	readonly demoId: string;
	readonly onSelect: (id: string) => void;
	readonly onClose: () => void;
}) {
	const example = fsxExamples.find(({ id }) => id === props.demoId) ?? fsxExamples[0];
	const selectorId = useId();
	return (
		<main className="min-h-screen p-4 md:p-8">
			<header className="mb-6">
				<button type="button" onClick={props.onClose}>
					Back to JSON Schema demos
				</button>
				<h1 className="text-2xl font-bold">Experimental FSX live playground</h1>
				<p>
					fsx-v1-experimental — source is not JavaScript. Fixed app-owned schemas and installed permissions; JSON is
					data, not authority.
				</p>
				<label htmlFor={selectorId}>FSX example </label>
				<select id={selectorId} value={example.id} onChange={(event) => props.onSelect(event.target.value)}>
					{fsxExamples.map(({ id, title }) => (
						<option key={id} value={id}>
							{title}
						</option>
					))}
				</select>
			</header>
			<FsxEditor key={example.id} example={example} />
		</main>
	);
}
import { useId } from "react";
