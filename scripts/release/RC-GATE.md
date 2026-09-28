#363 release gate: disabled pending positive implementation

The #363 live admin audit verified ruleset 24103769 and the `formbar-rc`
environment (22904271021, required reviewer `spralle` 806157, dispatcher
`eaglez`). These settings are not a publish authorization. The existing
`reject-dispatch` job remains unconditional: no environment-gated publish job,
OIDC permission, npm write, tag or release creation has been enabled.

The read-only source inspector now models the owner-approved role split and
rejects reruns (`runAttempt !== 1`). GitHub's workflow-run approvals API
returns reviewer, state and environment but does not document a review time or
attempt number; an approval on the same run cannot by itself prove approval
of a rerun attempt. Any implementation must reject reruns and use a new
dispatch, a new owner GO bound uniquely to that run, and a new environment
review for recovery. A pre-dispatch GO cannot include the run ID not yet
assigned by GitHub; a reusable SHA/tree-only GO is replayable. This binding
requires a separately agreed, testable protocol before connecting a publish
step. Until then, leave dispatch disabled rather than attaching a protected
environment to a job that could write without independently verifying it.

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
