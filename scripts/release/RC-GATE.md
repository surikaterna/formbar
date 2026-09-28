#363 release gate: disabled pending positive implementation

#365 adds `fetchRcEvidence`, an injected **GET-only** REST evidence reader.
It requires a GitHub-generated sender ID, runtime checkout SHA/tree, exact
run/attempt and fresh main tree, effective main rules, environment reviewer,
exact-SHA successful `ci` check, a NEW #250 owner FINAL GO and same-run
environment approval. GO uses `FINAL GO\n` followed by a single canonical
JSON object (no whitespace, duplicate keys or trailing text)
with `run_id`, `attempt`, full `sha`/`tree`, `versions` keyed by six package
names (each containing `version` and exact `dependencies`), and
`acknowledges_legacy_validation_issue` set to the required explicit migration
sentence in `live-go.ts`. A new run needs its own new comment. A deleted,
edited, expired, ambiguous or malformed comment denies. Comment timestamp
equality does **not** prove immutability: same-second edits/reversions and
fetch races remain an owner-accepted risk. The approvals endpoint does not
provide review timestamp/attempt; the owner accepted operational GO-before-
approval ordering without claiming it is API-proven. Attempt >1 denies.
No REST client with credentials, workflow step or publish capability is
supplied by this adapter; a synthetic positive fixture does not authorize a
release. #366 owns registry/OIDC/artifact verification; #363 owns final
gated enablement and re-fetching before each write. #298/#250 remain held.

The #363 live admin audit verified ruleset 24103769 and the `formbar-rc`
environment (22904271021, required reviewer `spralle` 806157, dispatcher
`eaglez`). These settings are not a publish authorization. The existing
`reject-dispatch` job remains unconditional: no environment-gated publish job,
OIDC permission, npm write, tag or release creation has been enabled.

The read-only source inspector models the owner-approved role split, requires
supplied GO evidence to name the exact run ID and attempt 1, and requires the
comment to be created after the run. This does NOT authenticate that evidence.
GitHub's workflow-run approvals API
returns reviewer, state and environment but does not document a review time or
attempt number; an approval on the same run cannot by itself prove approval
of a rerun attempt. Any implementation must reject reruns and use a new
dispatch, a new owner GO bound uniquely to that run, and a new environment
review for recovery. A pre-dispatch GO cannot include the run ID not yet
assigned by GitHub; a reusable SHA/tree-only GO is replayable. The owner
accepted the NEW post-dispatch comment before environment review as an
operational ordering requirement (#363 comment 5867388159), without claiming
the approvals REST response proves the relative chronology. Leave dispatch
disabled until separate gated enablement is audited.

#362 source preparation: `rc-source-check.ts` is an offline, read-only evidence
inspector, not an authority provider or executable publish entrypoint. Its inputs
are **untrusted** until a separately audited read-only adapter fetches live
GitHub, git, registry and npm evidence and repeats it immediately before each
irreversible write. Passing a mock is never permission to publish. The reviewed
#298 base/head and version tree must be independently observed after merge;
the resulting protected main SHA/tree needs its OWN renewed #250 FINAL GO.
An input SHA or editable issue comment alone cannot prove approval. An edited
or deleted comment must reject on fresh API fetch; the owner accepted the
24h editable-comment risk and the `eaglez` / `spralle` role split, not a FINAL GO.
Per-run environment approval must be fetched for the exact run, reviewer must
be different from dispatcher, and current effective branch/environment
rules must be independently inspected. The read-only inspector names the
appointed reviewer; it does not obtain a real review.
No OIDC trusted publisher, artifact identity/provenance, registry rc dist-tag
or `changeset publish --tag rc` implementation is enabled here. A separate
#363 enablement issue/PR must audit and implement those read-only verifications,
single-use/retry binding and publication transaction before removing the hard
dispatch reject; absent any one prerequisite, stop. npm writes cannot be rolled
back by GitHub tag or Release reconciliation. No environment is provisioned here.

Main pushes (including version-PR merges and runs with no Changesets) only refresh
the Changesets version proposal. Every release.yml dispatch fails before checkout,
OIDC permission, npm, tags, or release writes. The rc candidate checker is pure
and is **not** connected to a publish path. A matching SHA or open issue is not GO.

Owner/admin setup was audited in #363 but is mutable; there is no #250 final GO.
Do not create an environment from the workflow:
GitHub can create an unprotected environment automatically. An administrator must
retain the required reviewer distinct from requester, prevent self review,
disable admin bypass, restrict to main, and independently verify effective
rules and a real approval. Audit exact-head FINAL GO binding, expiry/replay rules,
pre.json rc mode/tag, six rc.0 versions and internal ranges, registry dist-tag and
gitHead for all six (including partial retry), OIDC trusted publishing/provenance,
and `changeset publish --tag rc` before a separate approved enablement change.
Reject stable/latest and conflicts; do not infer permission from this source PR.
#353 owns the prerelease proposal; #298 and #250 remain held.
