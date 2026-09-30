# #439 public predicate metadata evidence

Scope: the three public names omitted at the isolated npm process boundary.
The ready Architect evidence for run `36697570212` reports sanitized E422:
`github.event_name`, `repository_id`, and `repository_owner_id` were empty.
This work does not retry that run or claim that historical npm PUT was absent.
#250 remains RELEASE HOLD; #427 remains blocked on audited delivery.

Authenticated repository GET confirmed `surikaterna/formbar`, repository ID
`1245476636`, owner `surikaterna` ID `9478205`. The existing authenticated run
GET now binds those exact numeric IDs and names; the witness checks canonical
ambient ID strings and `workflow_dispatch`. The provider snapshots and freezes
the checked three public values and existing repository name before asynchronous preflight and passes only
those three additional names. No auth fallback or signature policy changes.

## Real generator, not signing evidence

Upstream source:
https://github.com/npm/cli/blob/v11.20.0/workspaces/libnpmpublish/lib/provenance.js
(lines 41–46 read the three exact public names).

Required local fixture tools (explicit absolute paths; missing tools fail, not skip):

- Node 22.23.2: `/home/sprawl/.local/share/mise/installs/node/22.23.2/bin/node`
  SHA-256 `3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327`
  (local Linux binary; other platforms have different binary hashes).
- npm 11.20.0 root: `/home/sprawl/.local/share/mise/installs/npm/11.20.0/package`
- `bin/npm-cli.js` SHA-256:
  `8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7`.
- Installed libnpmpublish **11.2.1**, `lib/provenance.js` SHA-256:
  `ee9b1bc8e3f636fbaf5138a3e183ce3c6d42bb5dd57ab004578e534dd08da46b`.

`rc-provenance-offline.test.ts` captures the real provider's child allowlist,
removes the existing OIDC request wiring **only for the fixture**, and invokes
the actual installed generator in a fresh pinned Node child. Before loading it,
the test-only CJS fixture replaces Sigstore with an unsigned byte-capture stub,
sets deterministic GitHub `ci-info`, blocks fetch/HTTP/HTTPS/socket/TLS, and denies
all other module loads. It never loads real Sigstore or supplies a signed bundle.
Two stub captures serialize fixed exact string values versus the old omission's
absent fields (`github: {}`). Everything else in the statement remains identical.
Required counters: network=0, oidc=0, signing=0, put=0, attestStub=2.
This is predicate evidence only, NOT cryptographic verification, registry
acceptance, private publisher-policy evidence, or permission to publish.

CI provisions the same exact Node/npm versions and executes this required test
in full Vitest, after frozen Bun 1.2.21 install and package build. Tool provisioning
may download tools; the generator fixture itself is offline with no credentials.

## Reproduce and quality gates

In the #439 worktree, frozen install and build must precede Vitest:

```sh
mise exec bun@1.2.21 -- bun install --frozen-lockfile
mise exec bun@1.2.21 -- bun run build
export RC_NODE_BINARY=/home/sprawl/.local/share/mise/installs/node/22.23.2/bin/node
export RC_NPM_ROOT=/home/sprawl/.local/share/mise/installs/npm/11.20.0/package
mise exec bun@1.2.21 node@22.23.2 -- bunx vitest run scripts/release/__tests__/rc-protected-providers.test.ts scripts/release/__tests__/live-evidence.test.ts scripts/release/__tests__/rc-run-authority.test.ts scripts/release/__tests__/rc-protected.test.ts scripts/release/__tests__/rc-provenance-offline.test.ts scripts/release/__tests__/rc-workflow.test.ts scripts/release/__tests__/rc-no-environment.test.ts
mise exec bun@1.2.21 node@22.23.2 -- bun run test
mise exec bun@1.2.21 -- bun run lint
mise exec bun@1.2.21 -- bun run typecheck:release-scripts
for package in core declarative from-schema react react-schema; do
  mise exec bun@1.2.21 -- bunx tsc --noEmit -p "packages/$package/tsconfig.json"
done
TMPDIR="$(mktemp -d /home/sprawl/formbar-439-consumers.XXXXXXXX)" mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bun run check:consumer-exports
TMPDIR="$(mktemp -d /home/sprawl/formbar-439-artifacts.XXXXXXXX)" mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bun run check:package-artifacts
mise exec actionlint@1.7.12 -- actionlint .github/workflows/release.yml .github/workflows/ci.yml
git diff --check
```

The authenticated witness change requires a regenerated read-only preflight
bundle and workflow/documented source hash pins; existing byte-reproduction
tests cover these. No workflow release authority or signature identity changes.

Code-principles self-check: cohesive handwritten production files <=400 lines,
functions <50 lines, nesting <=3; comments explain invariants/boundaries;
risk-based provider invalid/missing/spoof/snapshot tests and authenticated
identity-denial tests plus the actual generator negative control. The only
retained source-size exception is the generated bundle, already documented in
RC-PREFLIGHT.md. No new exception. No changeset: only internal release scripts,
tests, supporting CI, and evidence docs changed; no publishable package changed.

Exact-head hosted CI app15368 remains a merge/audit gate. No PR or workflow
dispatch is authorized by this implementation handoff; do not represent local
green gates as hosted CI. Auditor must independently verify the pushed SHA,
nonnetwork boundary, source pins, and unchanged signed identity/threshold policy.
