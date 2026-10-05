# FSX release integration preparation

Latest status: the normal-production QA repair and final green gate evidence are
recorded in [release-fsx-qa.md](release-fsx-qa.md). Earlier failures below are
retained as historical reproduction evidence, not the current QA result.

The highlighting proposal now enrolls public `@formbar/fsx-editor` as the ninth
RC package, after authoring. Authoring is `0.1.0-rc.1`, editor is `0.1.0-rc.0`
with authoring floor `^0.1.0-rc.1`; the seven other versions remain unchanged.
Earlier eight-package QA counts below describe their recorded revisions.
See [the active manual RC procedure](npm-trusted-publishing.md) for enrollment
and unresolved first-publication authentication; no publication is authorized here.

## Source and merge

- Worktree: `/home/sprawl/projects/formbar/trees/release-fsx-integration`.
- Branch: `feature/release-fsx-integration`, created exactly from audited FSX
  `da0a748fd2110a4774ddd719c344718b44c52f8c`, containing audited public #376
  `4879fcc5987095b2f91095d96e6dde1dc9c79e2a`.
- Fresh fetched main: `deaa45a` (#442), merge base `a7b0144`.
- `git merge --no-commit --no-ff origin/main`: no conflicts; merge is pending
  independent audit, not committed. Root's pre-existing unresolved main merge and
  all other worktrees/branches were left alone. No private PR was merged separately.
- #408 checkpoint `f03d970` / PR #431 was inspected, not merged. Public #376 already
  owns lifecycle, independent validation, omission and renderer contracts/tests;
  its public safety behavior is preserved rather than replacing it with private
  checkpoint APIs or importing duplicate checkpoint tests.

## Metadata

Changesets used the existing audited major public changeset and FSX minor
changeset. It proposes `1.0.0-rc.1` for declarative/from-schema/react-schema and
`0.1.0-rc.0` for FSX; four existing packages stay `0.23.0-rc.0`. The seven-member
linked group stays unchanged: linked is not fixed, and FSX remains independent.
Existing consumed IDs, initial versions and changelog history are retained.
FSX's stale stable Formbar ranges were corrected to the actual RC implementations.
The lock update reconciles Formbar workspace metadata only; it is **not** a
production Kalada installation or release claim. No new changeset is needed for
workflow/test preparation; existing runtime major/minor/patch changesets are used.

## Pending registry-owned dependencies — #317 (historical plan; adopted below)

Do **not** apply these as permanent production dependencies until genuine npm
registry publication of Kalada core `0.6.0`, syntax `0.1.0`, and provider-routing
`0.1.0`. The release plan CLI/artifact check fail closed while declarations are
missing. Candidate overlay installs are temporary evidence only.

| Manifest owner | Direct production declarations after publication |
| --- | --- |
| `@formbar/declarative` | `@kalada/core: 0.6.0`, `@kalada/syntax: 0.1.0` |
| `@formbar/fsx-authoring` | `@kalada/syntax: 0.1.0`, `@kalada/provider-routing: 0.1.0` |

FSX currently has no direct source import from core; syntax owns its core edge.
The root may declare syntax/router as development dependencies for consumer
fixtures, but that never substitutes for each package's direct runtime imports.
After registry publication, apply the table, regenerate the normal lock, and run
the workflow-pinned **normal** frozen install, full build/tests, package typechecks,
artifact/consumer checks and demo build without localhost registry, workspace
aliases to Kalada, candidate tarballs, overlay, test exclusions, or suppressed
install scripts. #317 is not green until those production gates pass.

## Active publishing and audit

The manual RC workflow stays owner/main/repository gated, sequential, RC-only,
public/provenance-enabled, and never changes `latest`. It covers exactly nine
packages with per-package versions, compatible internal RC floors, and declared
Kalada ownership. New authoring/editor absence is accepted only through structured `E404`;
both first publication and repeat RC-only runs must preserve absent `latest`.
Existing exact versions are immutable skips; malformed/auth/network errors stop.

The archived seven-package research contract and hashes remain unchanged.
Archive fixture construction selects its original RC section and verifies the
same history hash; newer legitimate proposal sections are not archival inputs.
Mock-only archived publisher tests use isolated working directories so a candidate
overlay's `.npmrc` does not masquerade as unexpected production authentication.
The ambient-config denial test remains active. `RC_BUN_BINARY` can pin the archived
rebuild tool to Bun 1.2.21 while Kalada's pinned lock requires newer Bun.

Independent Auditor must review the complete pending merge, metadata, workflow
and fixture delta before any commit/PR/merge/publication. One integration release
PR follows QA; no private held PR or branch deletion is authorized. First FSX npm
package creation/trusted-publisher capability remains an owner configuration gap,
not something offline tests prove.

## Validation evidence (2026-10-01)

All commands ran in the integration worktree; no commit, PR, remote branch,
publication, workflow dispatch or npm credential/settings mutation was performed.
Automatic merge staging is present; hand-written preparation changes and five
new files remain unstaged/untracked for audit. There are no unresolved conflicts
or unrelated edits in this worktree; it is intentionally **not** a clean Git index.

Final full candidate command (Bun 1.4.2 builds the original pinned Kalada lock v2;
the archive rebuild still uses Bun 1.2.21):

```sh
mise exec node@22.23.2 npm@11.20.0 -- bash -c 'export RC_NODE_BINARY="$(command -v node)" RC_NPM_ROOT="$(mise where npm@11.20.0)/package" RC_BUN_BINARY="$(mise where bun@1.2.21)/bin/bun"; export NPM_DIAGNOSTIC_NODE="$RC_NODE_BINARY" NPM_DIAGNOSTIC_ROOT="$RC_NPM_ROOT"; KALADA_REPO=/home/sprawl/projects/kalada node scripts/kalada-preflight/overlay.mjs'
```

Result: candidate lanes **PASS**, including focused lifecycle/write/omission and
FSX tests, package typechecks, full tests with only the harness's existing
no-production-dependency policy exclusion, lint, eight-package build, demo build,
clean frozen candidate graph, and actual packed eight-package ESM/CJS + strict
NodeNext + SSR/hydration consumers on React 18.3.1 and 19.2.0. Existing optional
archive integration probes remain skipped when their external fixtures are not
provided; no new skip was added. The temporary source manifests/lock and `.npmrc`
were restored byte-for-byte. All original Kalada tarball hashes are unchanged.

Retained log:
`dist/kalada-preflight-logs/formbar-316-overlay-1790860287149-3457757.log`,
SHA256 `a58698b4754b01885e775b0b147f734ceda6d84d5fb8cd2cdeeb15a3e2ac4bae`.
The restored baseline full test **FAILS** because registry core 0.1.0 lacks the
candidate V1 exports; the log explicitly records #317 production merge HOLD.
This candidate success is not a normal-production success.

Subsequent final focused command, after the last test additions:

```sh
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bash -c 'export RC_NODE_BINARY="$(command -v node)" RC_NPM_ROOT="$(mise where npm@11.20.0)/package" RC_BUN_BINARY="$(mise where bun@1.2.21)/bin/bun"; bun install --frozen-lockfile && bun run lint && bun run typecheck:release-scripts && bun x vitest run scripts/release/__tests__/rc-npm-workflow.test.ts scripts/release/__tests__/rc-workspace-plan.test.ts scripts/package-artifacts/__tests__/artifact-policy.test.ts scripts/release/__tests__/rc-workflow.test.ts scripts/release/__tests__/rc-disabled-sequence.test.ts scripts/release/__tests__/rc-protected-providers.test.ts scripts/release/__tests__/rc-provenance-offline.test.ts'
mise exec actionlint@1.7.12 -- actionlint .github/workflows/release.yml
git diff --check
git diff --cached --check
```

PASS: normal frozen installation (not production runtime), lint, strict release
typecheck, actionlint and whitespace checks; focused tests **206 passed, one
pre-existing optional archive probe skipped**. All 39 active workflow tests pass,
including distinct actual candidate versions, first FSX absence, repeat RC-only
existence, absent-latest preservation, auth denial and failed bootstrap stop.

`node scripts/release/rc-workspace-plan.mjs` and
`mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bun run check:package-artifacts`
both intentionally **FAIL CLOSED** on missing production Kalada declarations.
At that preparation checkpoint, `npm view @kalada/core@0.6.0 version --json`,
syntax@0.1.0 and provider-routing@0.1.0 each returned **E404**;
#317 was OPEN / `status:blocked`. See the subsequent registry read below.

Earlier failed candidate runs exposed stale nested pre-merge npm dependencies,
unpinned offline tools, archive fixtures coupled to newer changelog sections,
and archive mocks unintentionally reading the overlay's scoped `.npmrc`. These
were corrected without changing production archive guards or pinned hashes.
A Bun 1.2.21-only Kalada build also correctly rejected the pinned v2 lock; the
successful candidate command uses compatible Bun instead, not a converted lock.

Code-principles: new production helper is cohesive and below 400 lines; changed
production functions are below 50 lines with at most three nesting levels.
Comments explain archive isolation and invariants. Risk-based tests cover actual
workspace closure, versions/ranges, direct import ownership, RC-only provenance
argv, latest preservation, auth/PUT fail-stop and artifact rejection. No new
approved exception; the existing oversized test overlay remains a narrowly
modified research harness, not newly approved production source. Production
lint/test/build/artifact merge gates are **not all green** until #317 resolves.

## Auditor lock-metadata correction (2026-10-01, subsequent preparation)

Auditor found three stale dependency ranges despite pinned Bun's frozen install
passing. That earlier install was **not** proof of manifest/lock metadata parity.
`bun install --lockfile-only --ignore-scripts` under Bun 1.2.21 also left the three
ranges stale and removed `configVersion`; the unrelated removal was restored.
A scoped deterministic patch corrected only these three records relative to the
audited preparation lock:

- `packages/from-schema.dependencies.@formbar/declarative`: `^1.0.0-rc.1`.
- `packages/react-schema.dependencies.@formbar/declarative`: `^1.0.0-rc.1`.
- `packages/react-schema.dependencies.@formbar/from-schema`: `^1.0.0-rc.1`.

Generated manifest versions, prerelease history and changelogs were not changed.
An explicit assertion verified the **entire registry packages section is
byte-for-byte unchanged** from the pending merge index: all 435 records,
including transitive graph, tarball identities and registry integrities. Permanent
Kalada declarations remain zero across every workspace dependency category.

`scripts/release/workspace-lock.ts` structurally parses Bun's JSONC using the
existing TypeScript parser. Its CLI `bun run check:workspace-lock` compares
all **10** manifest owners (root, demos, eight packages) with the lock: workspace
presence, name/version, every direct/dev/optional/peer dependency name and range,
and Bun's derived `optionalPeers`. It is order-independent, not range-name-only.
The ordinary full test run includes a live repository parity assertion—there is
no test-only workaround, frozen-install suppression, or archived release gate.

Before correction the CLI failed with exactly the three Auditor mismatches;
after correction it reports `{"workspaces":10,"mismatches":[]}`.
Twenty-one added tests cover all workspace owners, the three exact stale edges,
missing/extra workspaces, version drift, changed/missing/extra dependency ranges
in all four categories, optional peers and structural parsing failures. The
checker and tests are included in strict release-script typechecking.

Exact successful combined parallel command:

```sh
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bash -c 'export RC_NODE_BINARY="$(command -v node)" RC_NPM_ROOT="$(mise where npm@11.20.0)/package" RC_BUN_BINARY="$(mise where bun@1.2.21)/bin/bun"; export NPM_DIAGNOSTIC_NODE="$RC_NODE_BINARY" NPM_DIAGNOSTIC_ROOT="$RC_NPM_ROOT"; bun install --frozen-lockfile && bun run check:workspace-lock && bun run lint && bun run typecheck:release-scripts && bun x vitest run scripts/release/__tests__ scripts/package-artifacts/__tests__ scripts/workflows/__tests__'
mise exec actionlint@1.7.12 -- actionlint .github/workflows/release.yml .github/workflows/ci.yml
git diff --check
git diff --cached --check
```

All gates above **PASS**. Combined suite: **683 passed, four existing optional
probes skipped** (39 passed files, three wholly skipped files); new checker
tests **21/21 PASS**. An initial strict-typecheck failure from `import.meta` in a
CommonJS `.ts` tooling file was corrected; the final gate passes without exceptions.

The optional candidate overlay was **not rerun**: this correction touches only
lock workspace metadata and internal validation tooling/tests, not runtime source
or generated release manifests. Previous candidate runtime evidence remains
historical; it does not certify the corrected lock. Any next overlay must snapshot
and restore the corrected current lock, as the existing harness does.

Latest pinned npm reads now find **core 0.6.0 available**, but **syntax 0.1.0** and
**provider-routing 0.1.0** still return E404. #317 remains OPEN / `status:blocked`.
No permanent candidate dependency addition, fresh publication/authentication
claim, runtime change, Changeset, commit, push, PR, merge completion or publication
was performed. First FSX package npm authentication/trusted-publisher capability
and normal production dependency/runtime gates remain external holds.

## Normal-registry production adoption attempt (2026-10-01, latest status)

The required registry **root metadata now resolves**. Only Formbar's required
Kalada packages were adopted: declarative directly owns core `0.6.0` and syntax
`0.1.0`; FSX directly owns syntax/router `0.1.0`. No direct FSX source/emitted
declaration import requires core. Other Kalada bootstraps, including pending
language-service publication, are not Formbar dependency gates.
The private demo app also directly imports core in its production inventory
module; its own manifest now declares core `0.6.0` rather than relying on hoisting.

Actual normal dependency installation:

```sh
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bun install --registry https://registry.npmjs.org --cache-dir /tmp/opencode/formbar-production-registry-attempt-20261001/bun-cache
```

**PASS**, with a legitimately regenerated Bun v1 lock. Bun omitted its default
`configVersion` field; that generated omission is retained, not hand-converted.
All prior corrected major RC edges remain correct. The registry graph adds
core `0.6.0`, syntax/router `0.1.0`, and retains core `0.1.0` under Kuery with its
original integrity. No unrelated external dependency upgrade was made.

Fresh external staging: `/tmp/opencode/formbar-production-registry-attempt-20261001/fresh-workspace`.
After the demo ownership declaration, the final graph was installed again in a
second empty stage, `fresh-workspace-final`, using `fresh-bun-cache-final`.
The final lock SHA256 is
`fcaeefe24e0a99830cd428ff540d6e9625abcf91d1d282dfb2b3c6d060db5e20`;
final fresh install and archive/physical-graph proof were rerun successfully.
The run-owned staging directory initially contained only the real root/workspace
manifests and lock—no node_modules, `.npmrc`, symlinked Kalada, source alias or
private Kalada workspace. From that exact cwd:

```sh
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bun install --frozen-lockfile --registry https://registry.npmjs.org --cache-dir /tmp/opencode/formbar-production-registry-attempt-20261001/fresh-bun-cache
```

**PASS** (316 packages installed). The fresh lock remained byte-identical to the
worktree lock. No ignore-scripts, localhost registry, candidate overlay, custom
tarball installation URL, workspace-core substitution or republish was used.

Normal root `npm view ... versions` and exact-version metadata resolved for all
three required packages. Registry archives were downloaded with **npm pack by
package name/version for read-only evidence, not installation**. Whole archive
bytes, audited SHA256, metadata SRI, installed package manifests/exports/types and
every installed packed file matched the original audited `1ed0ec83...` packs:

| Registry artifact | SHA256 | SRI |
| --- | --- | --- |
| core `0.6.0` | `44c8bd208fa4b1d0588821345a5b84eb521619acf7ecaf6eddabd1a79e63c0be` | `sha512-KE+Bkgw04bUrC7S15n0qRdteUYdZ5G7l9s8kP0JKc/0lf8jc9MYPZ7c+5CDne2pmTPUQo+lAfiedx8HTEVoxTg==` |
| syntax `0.1.0` | `a4ba2c6c935b8ab8708ed159ced0c6580ddfdf2bc60a52057843020209644524` | `sha512-KTZvBKqLQmheP15VHNY9OzOAZS+QAS4EckuOR87av1gRnfk26VaZgf0OnbnFsmzpGXdJLDMO1VC1j8OFRWtExw==` |
| provider-routing `0.1.0` | `086b20a7d85af5e261b4e2c9d27529d0f765a49ead2f764b97121c50bf84e2f9` | `sha512-R+i+4MzyKC70859QpfZHzDWYtA6OFvCp35Ncn5kBb/qkhpWBSbhH1jnnJO85WVarjQSJIg3j0r1We0lkaNQVyg==` |

Both graphs resolve declarative core and syntax's core to the same physical
registry-installed core `0.6.0`; expressions → Kuery → core `0.1.0` is a distinct
physical directory. The exported artifact constant already contains the exact
released core SHA; no manual identity change was made. Evidence helper and packs:
`/tmp/opencode/formbar-production-registry-attempt-20261001/proof.mjs` and
`registry-packs/` (`prepare` then `verify` modes, run with the pinned toolchain).

### Production gates — not all green

All gates used the normal installed registry graph, without overlay or exclusions.
Root frozen install, `bun run check:workspace-lock` (**10 owners, zero mismatches**),
`node scripts/release/rc-workspace-plan.mjs` (**eight RC packages**), `bun run lint`,
`bun run typecheck:release-scripts`, sequential `bun run build`, and demo build
**PASS**. Eight filtered `bunx tsc --noEmit -p packages/<name>/tsconfig.json`
checks pass for seven packages but **FAIL for from-schema**:

- `compile-kalada-occurrence.ts:160`: nonexistent `presentation` property.
- `direct-options.ts:9`: missing exported `CompilationContext`.
- `kalada-authored-native-evidence.ts:29`: assignment through readonly index.

Broad root `bunx tsc --noEmit -p tsconfig.json` also **FAILS** with TS6305:
composite per-source declaration expectations do not match bundled tsup outputs.

Full normal `bun run test` with pinned offline tool variables, **no exclusion**:
**2310 passed, one failed, four existing optional probes skipped**. The failure
is the existing code-principle assertion on `kalada-private-omission.ts` nesting
depth **5**, limit **3**. Only the package-dependency boundary assertion was
updated to require the real core/syntax declarations; no principle check was
disabled or weakened.
The full suite was rerun after the final demo ownership declaration with the
same result, using:

```sh
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bash -c 'export RC_NODE_BINARY="$(command -v node)" RC_NPM_ROOT="$(mise where npm@11.20.0)/package" RC_BUN_BINARY="$(mise where bun@1.2.21)/bin/bun"; export NPM_DIAGNOSTIC_NODE="$RC_NODE_BINARY" NPM_DIAGNOSTIC_ROOT="$RC_NPM_ROOT"; bun run test --reporter=dot'
```

`bun run check:package-artifacts` **FAILS** on `dist/index.cjs.map` referencing
`../../expressions/src/result.ts` outside the owning package source root.
`bun run check:consumer-exports` **FAILS** in the existing consumer fixture on
old generic `createSchemaForm`/`UseSchemaFormOptions` calls incompatible with the
audited new public contracts. Demo `typecheck` **FAILS** on source and fixture
typing errors (including readonly JSON and numeric/static path types); demo
`build` **PASSES** with the existing chunk-size warning.

Chromium installation attempted normally but the Playwright CDN timed out.
E2E was actually run using the available installed Chromium executable
(Chrome for Testing **154.0.8037.0**), via the
project's existing supported executable-path option (no application mocking):

```sh
mise exec bun@1.2.21 node@22.23.2 npm@11.20.0 -- bash -c 'export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/home/sprawl/.cache/ms-playwright/chromium-1246/chrome-linux64/chrome; bun run --filter @formbar/demos test:e2e'
```

**FAIL: six passed, 88 failed**. Many failures are missing historical
`data-formbar-node` selectors; root cause has not been independently established.
Retained traces/error contexts: `apps/demos/dist/playwright-results/`.
Captured full terminal output: `/home/sprawl/.local/share/opencode/tool-output/tool_0f85e4c67001smVYK20hCBAEQk`.
No browser settings or application feature behavior was changed.

### Immutable RC versions and scope

After a serial normal build, read-only comparison of published and local packed
**expressions/core/react/arbiter `0.23.0-rc.0`** proved all four archives exactly
byte-identical, including runtime, declarations, maps, manifests and file lists:
SHAs respectively `a5505999...`, `bdf3d8c1...`, `c3a46524...`, `b23bf0dd...`.
No new RC version is needed for those unchanged packages on this evidence.
Current declarative/from-schema/react-schema `1.0.0-rc.1` and FSX `0.1.0-rc.0`
queries still return E404. Registry absence is not first-package authentication
proof. Changeset major/minor runtime intent is already covered by the existing
public/FSX changesets; no additional version generation or source feature change
was performed by this dependency-adoption preparation.

Comparison helper/report: `/tmp/opencode/formbar-production-registry-attempt-20261001/immutable.mjs`
and `immutable-formbar/comparison.json`. An earlier comparison overlapped a test
that cleans/rebuilds core dist and observed transient missing files; that invalid
evidence was replaced by the successful serial build/comparison. The artifact
map failure was rerun after the serial build and persists independently.

This session retains the intended two package manifest edits, the private demo
core declaration and regenerated lock for
Auditor; it changes no runtime source. #317 **remains blocked**, now by normal
production QA rather than missing required Kalada root metadata. Proposed next
scope: a linked production-QA repair covering strict typing, nesting, source-map
ownership, public consumer fixture migration and actual browser failures. No new
issue or drive-by source fixes were created. First FSX npm publisher capability
and independent audit of this dependency/lock delta still precede delivery.

Code-principles: no new approved exception; manifest/test edits are cohesive and
bounded. Risk evidence includes genuine fresh install, full archive identity,
physical dual-core isolation, metadata/closure checks and full production tests.
The overall principle/CI checklist **does not pass** while the above gates fail.
Do not mark this release verified/green or commit/merge/publish on this evidence.
