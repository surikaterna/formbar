# #406 protected RC operator policy

> **Archived research — superseded by #442 and #250 comment 5913830240.**
> The historical policy below is not active release authority or a prerequisite.
> Use [the manual RC procedure](../../docs/npm-trusted-publishing.md).

Only `spralle` (GitHub user 806157) may manually dispatch `release.yml` for
the reviewed seven-package `0.23.0-rc.0` candidate. No #250 run-bound GO or
independent environment review is required. This is the owner's explicit policy
decision at #250 issuecomment-5887800273, not authorization for a dispatch
before source audit, merge and a fresh exact-main audit.

The runner-Node preflight checks the GitHub-generated sender, authenticated
same-run actor and triggering actor, first attempt, exact current protected
main SHA/tree, green same-SHA `ci` from app 15368 and PR+CI/no-bypass rules.
There is no deployment environment or environment API/approval gate (#434).
It checks the seven versioned manifests, prerelease plan and 23 consumed
changesets without installing dependencies or requesting OIDC. The publish
adapter repeats live checks before writes; no caller-provided approval flag
grants authority. The former unconnected #362 offline GO inspector and its
tests were removed because they described a superseded two-person policy.

The existing remote environment remains unused; do not change or delete it.
The intended existing npm publishers use `release.yml` with Environment BLANK.
All-seven sanitized npm admin readbacks, fresh independent main/rules/admin
bypass/CI audit and registry/tag reconciliation remain required before a
separately authorized NEW attempt1 dispatch. No settings writes are authorized.
Do not dispatch until these gates pass. No automatic push release is enabled:
main pushes only refresh the version proposal. `#298` has already merged.

After each public read-before-write, the adapter uses trusted npm OIDC and
`--tag rc`, then verifies actual registry-host tarball bytes and signed
provenance before the next package. `latest` remains unchanged. A failed,
uncertain or partial write stops the run: reconcile by reads and obtain a new
first-attempt dispatch after fresh audit; do not retry blindly. Seven writes
are non-atomic. The exclusive-create fence is runner-local, not cross-host
replay protection; the owner accepted this residual risk for this RC only.
