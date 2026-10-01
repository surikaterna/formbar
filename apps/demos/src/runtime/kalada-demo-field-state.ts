import { empty } from "./kalada-demo-state";
import type { Strategy } from "./kalada-demo-store";

export type Field = Parameters<NonNullable<Strategy["notifyScopedValidation"]>>[1]["field"];
type Metadata = { field: Field; dirty: boolean; touched: boolean };

/** Field identity is the admitted node plus lexical token chain, never its current array position. */
export class DemoFieldState {
	private readonly tokens = new WeakMap<object, number>();
	private next = 0;
	private readonly metadata = new Map<string, Metadata>();
	key(field: Field) {
		return JSON.stringify([
			field.path,
			field.scope.rows.map(({ name, token }) => {
				let id = this.tokens.get(token);
				if (id === undefined) {
					id = ++this.next;
					this.tokens.set(token, id);
				}
				return [name, id];
			}),
		]);
	}
	mark(field: Field, dirty: boolean, touched: boolean) {
		const key = this.key(field);
		const previous = this.metadata.get(key);
		this.metadata.set(key, {
			field,
			dirty: dirty || previous?.dirty === true,
			touched: touched || previous?.touched === true,
		});
	}
	read(field: Field) {
		const meta = this.metadata.get(this.key(field));
		return { ...empty(), dirty: meta?.dirty ?? false, touched: meta?.touched ?? false };
	}
	retire(tokens: ReadonlySet<object>) {
		for (const [key, meta] of this.metadata)
			if (meta.field.scope.rows.some((row) => !tokens.has(row.token))) this.metadata.delete(key);
	}
	clear() {
		this.metadata.clear();
	}
}
