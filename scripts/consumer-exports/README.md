# #345 packed public opt-in RC fixtures

Run `mise exec bun@1.2.21 -- bun install --frozen-lockfile`, then
`mise exec bun@1.2.21 -- bun run build`, then
`mise exec bun@1.2.21 -- bun run check:consumer-exports`. The harness packs
seven native tarballs, verifies installed files are not workspace links, and
installs them separately with React 18.3.1 or 19.2.0, matching React DOM,
types, TypeScript 5.7.3, and jsdom 26.1.0. Each React major has an isolated
temporary `node_modules`; no source imports are used by the omission fixtures.

| Fixture | ESM | CJS | What it asserts |
| --- | --- | --- | --- |
| `esm.mts` / `cjs.cts` | NodeNext | NodeNext | Packed public schema opt-in, typed hook options, scoped registrations, declaration/export resolution. |
| `omission-public.*` + `omission-cases.cjs` | import | require | Authored hide/submit/show/retry/reset; exact request vs draft; mock persisted PATCH-like server record (omission **does not delete** prior data); include override, shared/ancestor/unknown paths; generated two-level indexed repeaters and all-index field-ID override with Arbiter visibility; Ajv `if/then` required on final egress, scoped and legacy sync/async validation, identical successful final bytes/UI/context; unowned/root/plugin/egress veto; abort/reset/concurrent/reentrant/dispose no stale handler. |
| `omission-certified.cjs` | import caller | require caller | Public field validator produces certified hidden-invalid draft issues; valid omitted request is sent without mutating draft. |
| `omission-renderer.*` + `omission-renderer-cases.cjs` | import | require | Public `useSchemaForm` native renderer SSR/hydration, failed candidate summary/focus, final request and retained draft parity in React 18/19. |
| `schema-defaults.mjs`, `strict-lifecycle.mjs`, `scoped-*.*` | existing | existing | Default/full-draft behavior, strict lifecycle, scoped validation parity. |

The temporary fixtures require their own React environments: running CJS against
an ESM installation or React 19 against React 18 can hide resolution and
hydration failures. These tests run trusted same-realm callbacks, **not** a
privacy sandbox; the server must authorize and apply its own retention policy.

**Known blocker #346 (found by #345):** disposing an opt-in form while its
async validator is pending rejects `submit()` with `OWNED_STATE_UNSUPPORTED`
instead of returning a stale failure. The fixture explicitly asserts this
current exception **and** that the handler is never invoked. It is not a
passing disposal-contract proof; #250 release remains blocked pending repair
and independent audit. #298 is held; this fixture does not approve a version,
tag, release, or publication.
