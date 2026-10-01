import type { KaladaV1Host } from "@formbar/declarative";
import { useLayoutEffect, useMemo } from "react";
import type { RepeaterAssociation } from "./kalada-repeater-associations.js";

type Row = { element?: HTMLElement | undefined; controls: Map<string, HTMLElement> };
type Scope = {
	element?: HTMLElement | undefined;
	order: readonly string[];
	rows: Map<string, Row>;
	append: Map<string, HTMLButtonElement>;
};
type Ticket = RepeaterAssociation & {
	sequence: number;
	name: string;
	action: HTMLButtonElement;
	before: readonly string[];
};
const enabled = (element: HTMLElement | undefined) =>
	!!element?.isConnected && !("disabled" in element && element.disabled);

/** Focus is presentation only. No ref, row key or revision receipt grants a host mutation. */
export class RepeaterFocus {
	private readonly scopes = new Map<string, Scope>();
	private sequence = 0;
	private active = false;
	private revision: object | undefined;
	private pending: { ticket: Ticket; revision: object } | undefined;
	constructor(private readonly host: KaladaV1Host) {}
	activate() {
		this.active = true;
	}
	revoke() {
		this.active = false;
		this.pending = undefined;
		this.sequence++;
	}
	private scope(key: string) {
		let scope = this.scopes.get(key);
		if (!scope) {
			scope = { order: [], rows: new Map(), append: new Map() };
			this.scopes.set(key, scope);
		}
		return scope;
	}
	private row(scope: string, key: string) {
		const rows = this.scope(scope).rows;
		let row = rows.get(key);
		if (!row) {
			row = { controls: new Map() };
			rows.set(key, row);
		}
		return row;
	}
	container(key: string, element: HTMLElement | null) {
		if (element) this.scope(key).element = element;
		else this.scopes.delete(key);
	}
	rowElement(scope: string, key: string, element: HTMLElement | null) {
		if (element) this.row(scope, key).element = element;
		else {
			const row = this.scopes.get(scope)?.rows.get(key);
			if (row) row.element = undefined;
		}
	}
	control(scope: string, row: string, key: string, element: HTMLElement | null) {
		if (element) this.row(scope, row).controls.set(key, element);
		else this.scopes.get(scope)?.rows.get(row)?.controls.delete(key);
	}
	append(scope: string, key: string, element: HTMLButtonElement | null) {
		if (element) this.scope(scope).append.set(key, element);
		else this.scopes.get(scope)?.append.delete(key);
	}
	order(scope: string, keys: readonly string[]) {
		const entry = this.scope(scope);
		entry.order = keys;
		const current = new Set(keys);
		for (const key of entry.rows.keys()) if (!current.has(key)) entry.rows.delete(key);
	}
	observe(revision: object) {
		this.revision = revision;
		this.flush();
	}
	begin(association: RepeaterAssociation | undefined, name: string, action: HTMLButtonElement) {
		if (!association || !this.active) return;
		return {
			...association,
			sequence: ++this.sequence,
			name,
			action,
			before: [...this.scope(association.scope).order],
		};
	}
	complete(ticket: Ticket | undefined, revision: object | undefined) {
		if (
			!ticket ||
			!revision ||
			!this.active ||
			ticket.sequence !== this.sequence ||
			this.host.currentRevision() !== revision
		)
			return;
		this.pending = { ticket, revision };
		this.flush();
	}
	private flush() {
		const pending = this.pending;
		if (!pending || this.revision !== pending.revision) return;
		this.pending = undefined;
		if (!this.active || pending.ticket.sequence !== this.sequence || this.host.currentRevision() !== pending.revision)
			return;
		const scope = this.scopes.get(pending.ticket.scope);
		if (!scope || !enabled(scope.element)) return;
		this.focus(scope, pending.ticket);
	}
	private focus(scope: Scope, ticket: Ticket) {
		if (["array.move", "array.swap"].includes(ticket.name) && enabled(ticket.action)) {
			ticket.action.focus();
			return;
		}
		const before = new Set(ticket.before);
		const removed = ticket.row ? ticket.before.indexOf(ticket.row) : -1;
		const key = ["array.append", "array.insert"].includes(ticket.name)
			? scope.order.find((key) => !before.has(key))
			: scope.order[Math.min(Math.max(0, removed), scope.order.length - 1)];
		const row = key && scope.rows.get(key);
		const control = row && [...row.controls.values()].find(enabled);
		const fallback = [...scope.append.values()].find(enabled) ?? scope.element;
		(control || (row && enabled(row.element) && row.element) || fallback)?.focus();
	}
}

export function useRepeaterFocus(host: KaladaV1Host, revision: object) {
	const focus = useMemo(() => new RepeaterFocus(host), [host]);
	useLayoutEffect(() => {
		focus.activate();
		return () => focus.revoke();
	}, [focus]);
	useLayoutEffect(() => focus.observe(revision), [focus, revision]);
	return focus;
}
