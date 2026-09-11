# @formbar/react

React hooks and accessibility helpers for forms created with `@formbar/core`.

## Reactive ordinary expression props (#90)

`useExpressionProps(service, definitions)` observes **all** expression props,
not only values/visibility. It returns `{ values, setters, diagnostics }`.
Direct `mode: "write"` refs have authorized setters; derived/read expressions do
not. Services use host-supplied backends and namespaces. Keep definitions stable.

```tsx
import { useExpressionProps } from "@formbar/react";
import type { ExpressionService, PropDefinitions } from "@formbar/expressions";

const quantity = { kind: "ref", ref: { namespace: "data", segments: ["quantity"] } } as const;
const props: PropDefinitions = {
  value: { mode: "write", expression: quantity },
  disabled: { mode: "read", expression: {
    kind: "op", op: "lte", args: [quantity, { kind: "literal", value: 0 }],
  } },
  total: { mode: "read", expression: {
    kind: "op", op: "multiply", args: [quantity, {
      kind: "ref", ref: { namespace: "data", segments: ["unitPrice"] },
    }],
  } },
};
export function Quantity({ service }: { service: ExpressionService }) {
  const { values, setters } = useExpressionProps(service, props);
  return <>
    <input aria-label="Quantity" type="number" value={String(values.value ?? "")}
      onChange={event => setters.value?.(Number(event.currentTarget.value))} />
    <output>{String(values.total ?? "")}</output>
    <button type="button" disabled={Boolean(values.disabled)}>Buy</button>
  </>;
}
```

The host constructs/disposes the service outside render and registers core using
`createCoreExpressionNamespaces(form)`. No provider dependency is imposed on this
hook. `useSyncExternalStore` handles StrictMode/unmount/rebinding; resource-free
observation construction does not leak on abandoned renders. Replacement releases
old subscriptions and invalidates retained binding setters. Use the neutral
`forwardExpressionProp` helper with a host type guard for typed custom-widget
forwarding rather than unchecked casts. This is not a full declarative renderer.

## Package installation

```bash
bun add @formbar/react @formbar/core react
# or
npm install @formbar/react @formbar/core react
```

## Minimal usage

```tsx
import { useField, useForm } from "@formbar/react";

type Contact = {
	email: string;
};

export function ContactForm() {
	const form = useForm<Contact, Record<string, never>>({
		initialData: { email: "" },
		onSubmit: async ({ payload }) => {
			await saveContact(payload);
			return { ok: true, submitId: "contact-create" };
		},
	});
	const email = useField(form, "email", { label: "Email", required: true });

	return (
		<form onSubmit={(event) => void event.preventDefault()}>
			<input
				value={email.get() ?? ""}
				onBlur={() => email.handleBlur()}
				onChange={(event) => email.handleChange(event.currentTarget.value)}
			/>
			<button type="button" onClick={() => void form.submit()}>
				Save
			</button>
		</form>
	);
}
```

## When to use this package

- Use `@formbar/react` when you want React lifecycle management, field subscriptions, selectors, and ARIA helpers for a Formbar form.
- Use `@formbar/core` directly for non-React environments or custom framework bindings.
- Use `@formbar/react-schema` when forms should be prepared from schemas and rendered through layout nodes.

## Dependencies

- Depends on `@formbar/core`.
- Peer dependency: `react >=18.0.0`.

`autoFocusOnError` is handled by `useForm` and is not forwarded to core. Other options are forwarded unchanged, so
core's development-only unknown-option diagnostics also apply to `useForm` without duplicate React-option warnings.
