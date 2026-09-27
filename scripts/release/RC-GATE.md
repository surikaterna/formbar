#350 release gate: disabled

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
