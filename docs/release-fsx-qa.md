# Normal-production FSX integration QA — 2026-10-01

Engineer status: **implemented, ready for independent audit; not verified or
approved for publication**. This supersedes the latest failing QA checkpoint in
[release-fsx-integration.md](release-fsx-integration.md), not its historical logs.

## Exact delivery

- Cwd/worktree: `/home/sprawl/projects/formbar/trees/release-fsx-integration`.
- Branch: `feature/release-fsx-integration`.
- Base/unchanged HEAD: `da0a748fd2110a4774ddd719c344718b44c52f8c`.
- Pending merge: `deaa45a433a4e00f65953ab4c1b707b035652824`.
- Merge base: `a7b0144d14f41051ddf10b978b66b5a3a2969058`.
- No commits, staging, merge completion, PR, push, publication, workflow dispatch,
  credential/settings mutation or edits to another worktree were performed.
- The inherited merge index remains staged. QA changes are unstaged; the new
  readonly JSON helper and this report are untracked, alongside inherited
  preparation files. Auditor must review **all three** scopes, not HEAD alone.

Audit commands: `git status --porcelain=v1`, `git diff HEAD`, `git diff --cached`,
`git diff`, `git ls-files --others --exclude-standard`, `git ls-files -u`,
`git rev-parse HEAD MERGE_HEAD`, `git merge-base HEAD MERGE_HEAD`.
Whitespace checks `git diff --check` and `git diff --cached --check` pass;
`git ls-files -u` returns no conflicts. Final cached scope is 95 files, unstaged
tracked scope 86 files, their HEAD-relative union 160 files, plus nine untracked
files. No new implementation commit exists.

## Focused repairs, without changing the public V1 contract

- Omission: extracted typed row/directive snapshot helpers and replaced the
  five-deep diagnostic conditional with explicit status mapping. Freezing,
  ownership, freshness, outgoing validation and proof checks are unchanged.
- Schema compiler: local diagnostic context contract replaces the retired
  context import; the container presentation interface names its optional
  presentation; native evidence traverses readonly DTOs by returning copies.
  No double casts or relaxed admission contract were introduced.
- Typecheck: root is a solution referencing all eight packages. `bun run
  typecheck` builds actual project declarations into separate `.types` outputs;
  bundled publication still uses `dist`. CI runs this gate. Generated outputs
  are ignored by Git/Biome, not source diagnostics; TS6305 is not suppressed.
- Artifact ownership: react-schema's existing expressions imports now have a
  direct runtime dependency and active RC graph edge. tsup consequently emits
  actual external package imports, not sibling source content in sourcemaps.
  Source-map validation was not loosened. Two risk tests check real import
  declarations/re-exports and reject the missing edge. Archived seven-package
  fixtures reconstruct their frozen graph; archived guards/hashes are unchanged.
- Packed consumers: existing ESM/CJS/require/Bundler and upstream surfaces remain
  checked. Actual eight-package V1/FSX public consumers replace retired positive
  FormApi schema installation. Normal npm installs use the public registry,
  execute install scripts, and use no candidate archives, `.npmrc` copy or overlay.
  React 18/19 SSR/hydration, native/custom writers, defaults, submit/reset,
  independent validation, hidden omission with retained draft, row identity,
  profile replacement and stale/denied/unsafe boundaries remain exercised.
- Demo types: canonical FormDefinition/field/validation fixtures, string direct
  locations, readonly-to-Kalada JSON copies and guarded static path types replace
  obsolete inferred shapes. Numeric static schema paths remain denied: this is
  not an index-write grant or permissive host policy.
- Real presentation regressions: custom ranges receive inert schema bounds and
  a numeric-literal maximum only in the trusted range descriptor; rendering does
  not initialize optional model values. Rating labels/selected appearance and
  native/custom/layout/repeater CSS follow actual V1 markup. No test IDs were
  added to production. Existing schema fixtures were not rewritten.
- Real focus regression: a denied submission focuses once per attempt/host;
  later blur metadata cannot steal keyboard focus. A regression test proves
  metadata leaves another control focused and a new failed attempt refocuses.

## Classification of the original 88 Chromium failures

Counts below include both desktop and narrow projects and exhaust the original
failure summary at lines 3143–3233 of
`/home/sprawl/.local/share/opencode/tool-output/tool_0f85e4c67001smVYK20hCBAEQk`.
Some obsolete selectors masked additional real defects, so categories are not
pretended to be mutually exclusive root causes.

| Existing spec | Original failures | Classification and retained observable coverage |
| --- | ---: | --- |
| all-playground-examples | 4 | Retired form/preparation/data panels; all 28 routes, real edits, atomic invalid apply/recovery and navigation retained. Missing extensions now fail closed instead of submitting through the retired fallback. |
| custom-layout-responsive | 16 | Retired form/control markers plus real CSS width/grid mismatches; all section/tab/accordion responsive and keyboard cases retained. Definition replacement follows V1's fresh-document reset; same-document profile retention is separately covered by packed/host tests. |
| custom-widget-selection | 18 | Retired form/data selectors masked real rating accessible-name/selected-appearance defects; dark/light, native keyboard writes, typed submission, reset and source switching retained. |
| historical-options | 10 | Group→radiogroup, numeric option values/placeholders, duplicate host/definition action buttons and explicit row destinations; option order, disabled choices, typed payloads and reset retained. |
| historical-sliders | 8 | Genuine lost custom range bounds/display plus retired observability API; optional untouched payloads, min/max/step, keyboard edits, submit and reset retained. |
| legacy-passenger-text | 2 | Retired form marker only; historical DOB/phone text submit/reset preserved. |
| repeater-actions | 4 | Removed demo markers and positional action API; real stable keys/destinations, native/custom focus fallback, geometry, min/max refusal and projected submission retained. Artificial nested DOM injection replaced with a real cross-scope destination refusal, checking both lists remain unchanged. |
| schema-only-options | 4 | Retired generated label/option tokens/preparation panel; titled/disabled authoritative enum values and conflicting-props rejection retained through actual controls/submission. |
| unit-price | 2 | Retired form marker; decimal cents and independent schema-vs-presentation bounds unchanged. |
| validation-cues | 20 | Retired field/summary/status/error-list markers and automatic legacy validation timing; explicit V1 submit validation, linked issues, required presentation vs schema authority, hidden-invalid refusal and successful-history retention preserved. Real required-cue CSS and repeated-denial focus trapping repaired. |
| **Total** | **88** | All 94 existing tests now pass; none skipped or deleted. |

SSR/hydration evidence is from the real packed React consumers; the Vite demo
Playwright suite is a browser CSR application, not claimed as an SSR server test.

## Final normal-production gates

Pinned binaries: Bun `1.2.21`, Node `v22.23.2`, npm `11.20.0`. All root commands
below ran in the exact integration cwd, against the released normal registry
graph; **no overlay, Kalada source alias, test exclusion or suppressed install**.

```sh
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bash -c 'export RC_NODE_BINARY="$(command -v node)" RC_NPM_ROOT="$(mise where npm@11.20.0)/package" RC_BUN_BINARY="$(mise where bun@1.2.21)/bin/bun"; export NPM_DIAGNOSTIC_NODE="$RC_NODE_BINARY" NPM_DIAGNOSTIC_ROOT="$RC_NPM_ROOT"; bun install --frozen-lockfile && bun run check:workspace-lock && bun run lint && bun run --filter "@formbar/*" build && bun run build && bun run test && bun run check:package-artifacts && bun run check:consumer-exports'
```

**PASS every command**. Workspace lock: ten owners, zero mismatches. Filtered
build: all eight package strict checks plus demo build. Full suite: **2313 passed,
zero failed, four pre-existing optional probes skipped** (250 passed files).
All eight artifacts pass map ownership/content and byte-reproducible packing.
Actual packed public V1/FSX consumers pass ESM/CJS, strict NodeNext and
SSR/hydration on React `18.3.1` and `19.2.0`; old package export/type surfaces also
pass all five fixture modes per React version.

Full final log:
`/home/sprawl/.local/share/opencode/tool-output/tool_0f8a892b90019dUtB9d9JX3lqQ`,
SHA256 `d495b1db8fc500c4bb348922c4f1fa6d809ab6563c0327ce8383f40c06570f65`.

Additional exact gates:

```sh
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bash -c 'bun run typecheck && bun run typecheck:release-scripts && node /tmp/opencode/formbar-production-registry-attempt-20261001/immutable.mjs'
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bash -c 'export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/sprawl/.cache/ms-playwright/chromium-1246/chrome-linux64/chrome; bun run --filter @formbar/demos typecheck && bun run --filter @formbar/demos build && bun run --filter @formbar/demos test:e2e --workers=8'
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bash -c 'export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/sprawl/.cache/ms-playwright/chromium-1246/chrome-linux64/chrome; bun run --filter @formbar/demos test:e2e --workers=8 --reporter=json'
mise exec actionlint@1.7.12 -- actionlint .github/workflows/ci.yml .github/workflows/release.yml
```

**PASS**. Chromium: **94 expected, zero skipped/unexpected/flaky**, twice on final
runtime source. The supported executable override uses Chrome for Testing
`154.0.8037.0`; the pinned browser CDN was unavailable at the prior checkpoint.
This is explicitly an executable override, not a claim that the pinned browser
download succeeded. Existing Vite chunk-size and test `act` warnings are not
hidden, and do not fail their gates.

Final JSON browser log:
`/home/sprawl/.local/share/opencode/tool-output/tool_0f8b2dcf0001WQYO4S7VoPYzsz`,
SHA256 `d4bbb8c2ba5116f9e03726caa206ebffab01d6431e0117d609313dcce830a60d`.
The final logged rerun additionally ran `bunx biome check --write
apps/demos/e2e/repeater-actions.spec.ts && bun run lint` before the browser command,
and retains toolbar contrast, touch-size, non-overlap and viewport assertions.

### Fresh frozen registry graph after the repaired lock

New empty stage contains only root/workspace manifests and the current lock,
not source, node_modules or `.npmrc`. Exact commands:

```sh
# Integration cwd
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- node /tmp/opencode/formbar-release-qa-registry-proof.mjs prepare
# Cwd: /tmp/opencode/formbar-release-qa-registry-20261001
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bun install --frozen-lockfile --registry https://registry.npmjs.org --cache-dir /tmp/opencode/formbar-release-qa-registry-cache-20261001
# Integration cwd
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- node /tmp/opencode/formbar-release-qa-registry-proof.mjs verify
```

**PASS**: 316 packages installed; root/stage lock byte equality. Current lock
SHA256 `52528d94b506293643422bdabf68e549e8021b770f2f65cf398a3ded96654ff9`.
Both graphs resolve declarative and syntax to the same genuine core `0.6.0`,
distinct from Kuery's genuine core `0.1.0`. Released core/syntax/router archives
retain the exact SHA/SRI proof in the integration report; the QA repair changes
no Kalada declaration/version or external registry artifact identity.

## Immutable versions, Changesets and remaining delivery holds

Read-only npm archive comparison after runtime repair proves whole tarball bytes,
file lists and contents remain identical for all four published RC0 packages:

| Package at `0.23.0-rc.0` | Published = local SHA256 |
| --- | --- |
| expressions | `a55059995eb31393e80469be79ee4ebc74fbdb85c5f32437e5eb02a3ee7b95bb` |
| core | `bdf3d8c172c56fe1333ad1fc027f3cc507dd0a7a8ef8c83f068542cfe47e15ea` |
| react | `c3a465247f3d7c596acc368d81d14715ab782fbf118021e6949bb463854a5fdc` |
| arbiter | `b23bf0dd15f2208cd77d9ad011b5b5d7a47c8c745e307a640812b2e6b44fb182` |

Comparison report:
`/tmp/opencode/formbar-production-registry-attempt-20261001/immutable-formbar/comparison.json`.
No changed published artifact is silently skipped. Read-only pinned `npm view
<package>@<version> version --json --registry https://registry.npmjs.org` returns
structured **E404** for declarative/from-schema/react-schema `1.0.0-rc.1` and FSX
`0.1.0-rc.0`. These remain unpublished proposals, not immutable existing versions.
The consumed `public-kalada-v1` major Changeset still covers the three breaking
packages, and FSX retains its independent minor/first-release plan. No version
generation, consumed history rewrite, linked-group change or additional API
feature was introduced by QA; an extra bump for an unpublished repair is not
needed. Any future registry identity drift must stop delivery and be versioned.

Code-principles self-check: correctness/ownership, cohesive production files
under 400 lines, functions under 50 lines, nesting at most three, intent-only
comments and risk-based coverage pass. Existing production inventory was extended
to include the actual changed modules, not weakened. **No new approved exception**.
Lint, strict typechecks, full tests, publication artifact/consumer and browser
gates pass. Added risk evidence covers missing direct ownership, metadata focus
stability/new attempts, cross-scope refusal and actual hidden outgoing omission
without erasing draft data. Existing unsafe/stale/denied tests remain active.

There is **no remaining demonstrated source QA blocker**. Independent Auditor
must review this whole pending delivery before any commit/PR/merge/release-owner
go decision. First FSX package creation/trusted-publisher capability is still
owner delivery configuration, not certified by offline tests or registry E404.
#317 remains OPEN and now has the supported `status:implemented` label, not
verification or closure. Evidence handoff:
https://github.com/surikaterna/formbar/issues/317#issuecomment-5937798500.
Nothing here authorizes publication or credential work.
