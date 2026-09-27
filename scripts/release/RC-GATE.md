#350 release gate: disabled

#362 source preparation: `rc-source-check.ts` is an offline, read-only evidence
inspector, not an authority provider or executable publish entrypoint. Its inputs
are **untrusted** until a separately audited read-only adapter fetches live
GitHub, git, registry and npm evidence and repeats it immediately before each
irreversible write. Passing a mock is never permission to publish. The reviewed
#298 base/head and version tree must be independently observed after merge;
the resulting protected main SHA/tree needs its OWN renewed #250 FINAL GO.
An input SHA or editable issue comment alone cannot prove approval. An edited
or deleted comment must reject on fresh API fetch; the proposed 24h comment
policy, signer and designated non-self reviewer still require OWNER acceptance.
Per-run environment approval must be fetched for the exact run, reviewer must
be different from dispatcher and signer, and current effective branch/environment
rules must be independently inspected. No reviewer is appointed in source.
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

Owner/admin setup is blocked: no dedicated protected release environment with
required non-self human reviewers, no verified no-bypass rule or effective main
protection, and no #250 final GO. Do not create an environment from the workflow:
GitHub can create an unprotected environment automatically. An administrator must
configure required reviewer(s) distinct from requester, prevent self review,
disable admin bypass, restrict to protected main, and independently verify effective
rules and a real approval. Audit exact-head FINAL GO binding, expiry/replay rules,
pre.json rc mode/tag, six rc.0 versions and internal ranges, registry dist-tag and
gitHead for all six (including partial retry), OIDC trusted publishing/provenance,
and `changeset publish --tag rc` before a separate approved enablement change.
Reject stable/latest and conflicts; do not infer permission from this source PR.
#353 owns the prerelease proposal; #298 and #250 remain held.
