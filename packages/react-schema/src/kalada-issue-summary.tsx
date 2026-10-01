import type { KaladaV1Host } from "@formbar/declarative";
import { type RefObject, useEffect } from "react";

type View = ReturnType<KaladaV1Host["snapshot"]>;
const messages = (control: View["controls"][number]) => [
	...(control.lifecycle?.issues.schema ?? []),
	...(control.lifecycle?.issues.extension ?? []),
];

function labels(node: View["tree"]): [string, string][] {
	const children = [
		...(node.children ?? []),
		...(node.items?.flatMap((item) => item.children) ?? []),
		...(node.rows?.flatMap((row) => row.children) ?? []),
	];
	return [[node.key, node.label ?? node.nodeId], ...children.flatMap(labels)];
}

function focusControl(form: HTMLFormElement | null, id: string) {
	const owner = form?.ownerDocument.getElementById(id);
	if (!(owner instanceof HTMLElement) || !form?.isConnected || !form.contains(owner)) return false;
	const selector =
		'input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),[tabindex]:not([tabindex="-1"])';
	const target = owner.matches(selector) ? owner : owner.querySelector<HTMLElement>(selector);
	if (!target || !target.isConnected) return false;
	target.focus();
	return form.ownerDocument.activeElement === target;
}

export function useDeniedFocus(
	status: string,
	host: KaladaV1Host,
	view: View,
	prefix: string,
	form: RefObject<HTMLFormElement | null>,
	summary: RefObject<HTMLDivElement | null>,
) {
	useEffect(() => {
		if (status !== "denied" || host.currentRevision() !== view.revision || !form.current?.isConnected) return;
		for (const control of view.controls)
			if (messages(control).length && focusControl(form.current, `${prefix}-${encodeURIComponent(control.key)}`))
				return;
		summary.current?.focus();
	}, [status, host, view, prefix, form, summary]);
}

export function KaladaIssueSummary({
	view,
	prefix,
	form,
	summary,
}: {
	view: View;
	prefix: string;
	form: RefObject<HTMLFormElement | null>;
	summary: RefObject<HTMLDivElement | null>;
}) {
	const issues = [...(view.lifecycle?.issues.schema ?? []), ...(view.lifecycle?.issues.extension ?? [])];
	const names = new Map(labels(view.tree));
	if (!issues.length) return null;
	return (
		<div ref={summary} role="alert" tabIndex={-1} data-kalada-issue-summary="">
			<p>{issues.join(" ")}</p>
			<ul>
				{view.controls
					.filter((control) => messages(control).length)
					.map((control) => {
						const id = `${prefix}-${encodeURIComponent(control.key)}`;
						return (
							<li key={control.key}>
								<a
									href={`#${id}`}
									onClick={(event) => {
										event.preventDefault();
										if (!focusControl(form.current, id)) summary.current?.focus();
									}}
								>
									{names.get(control.key) ?? control.nodeId}: {messages(control).join(" ")}
								</a>
							</li>
						);
					})}
			</ul>
		</div>
	);
}
