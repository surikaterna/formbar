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
| `omission-public.*` + `omission-cases.cjs` | import | require | Authored hide/submit/show/retry/reset; exact request vs draft; mock persisted PATCH-like server record (omission **does not delete** prior data); include override, shared/ancestor/unknown paths; generated two-level indexed repeaters and all-index field-ID override with Arbiter visibility; Ajv `if/then` required on final egress, each named scoped and legacy sync/async validator exactly once on identical immutable FINAL bytes/UI/stage/context on failed and successful attempts (success shares handler payload and actual submitContext); unowned/root/plugin/egress veto; abort/reset/concurrent/reentrant no stale handler; successful aborted dispose without late handler or publication. |
| `omission-certified.cjs` | import caller | require caller | Public field validator produces certified hidden-invalid draft issues; valid omitted request is sent without mutating draft. |
| `omission-renderer.*` + `omission-renderer-cases.cjs` | import | require | Public `useSchemaForm` native renderer SSR/hydration, failed candidate summary/focus, final request and retained draft parity in React 18/19. |
| `schema-defaults.mjs`, `strict-lifecycle.mjs`, `scoped-*.*` | existing | existing | Default/full-draft behavior, strict lifecycle, scoped validation parity. |

The temporary fixtures require their own React environments: running CJS against
an ESM installation or React 19 against React 18 can hide resolution and
hydration failures. These tests run trusted same-realm callbacks, **not** a
privacy sandbox; the server must authorize and apply its own retention policy.
The public form API has no stage setter: these packed submit fixtures explicitly
assert the exact absent (`undefined`) stage, not a fabricated nonempty stage.
The public handler receives a plain submitContext while guarded validators see
an independently owned null-prototype context: the fixture compares actual
handler/validator context values (not cross-boundary identity), and asserts
identity of the public handler payload with every FINAL validator's data.

The #346 fix merged into main before this fixture refresh. Its independent
packed ESM/CJS disposal fixture remains in the harness; this RC case also
verifies aborted disposal of the authored public opt-in with no late handler
or publication. #250 still requires independent RC and owner signoff; #298
remains held. This fixture does not approve a version, tag, or publication.
