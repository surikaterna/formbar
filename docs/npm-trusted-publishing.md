# npm trusted publishing: protected seven-package RC

The manual protected RC job in `.github/workflows/release.yml` publishes reviewed
tarballs using direct `npm publish --provenance --tag rc` through GitHub Actions
OIDC. No deployment environment is attached. There is no `NPM_TOKEN`,
`NODE_AUTH_TOKEN`, local bootstrap, Changesets-publish or token fallback path.
Main pushes update only the version proposal, not publication.

## Intended existing publisher identity (not verified configuration)

For EACH of these seven public packages:

- `@formbar/core`
- `@formbar/arbiter`
- `@formbar/declarative`
- `@formbar/expressions`
- `@formbar/from-schema`
- `@formbar/react`
- `@formbar/react-schema`

A human npm package administrator must inspect Settings -> Trusted publishing
and Publishing access, read-only, and report sanitized yes/no/unknown categories:

- Provider GitHub Actions; repository owner/name exactly `surikaterna/formbar`.
- Workflow filename exactly `release.yml` (filename, not path; case sensitive).
- Environment name **BLANK**, matching the no-environment RC job (#434).
- Allowed actions include **direct npm publish**, not merely stage publishing.
- Public visibility and publishing/MFA policy compatible with OIDC.
- Other relevant connections present: yes/no/unknown, without identifiers.

Do not create, modify or remove connections, npm settings or credentials. The
existing GitHub deployment environment may remain unused; do not delete it.
Readback of expressions alone does not establish settings for the other six.
If admin access is unavailable, record UNVERIFIED and retain release HOLD.
Public metadata, dry runs and diagnostic categories cannot establish these
private settings or prove historical authentication success/failure or no PUT.

## Publication and release fence

The intended default OIDC subject is
`repo:surikaterna/formbar:ref:refs/heads/main`. This is not the Fulcio certificate
workflow SAN; production signed verification still requires the exact workflow
URI/ref, repository, commit, run and attempt, issuer, certificate OIDs and
transparency verification. Blank environment does not weaken these checks.

The reviewed candidate remains all seven `0.23.0-rc.0` packages and the exact
23-ID version graph. Before every write, the adapter rechecks current protected
main SHA/tree, manual spralle identity (806157), attempt1, PR/rules policy and
unique green exact-SHA ci app15368. The redacted bypass exception requires fresh
independent authenticated admin `bypass_actors: []` readbacks before dispatch
and postflight, never an inferred empty list.

Each publication uses explicit `rc`, never `latest`; registry-host bytes and
signed provenance must verify after publication before the next package.
Any uncertain or partial failure stops publication and requires reconciliation,
not a retry. #250 remains RELEASE HOLD and #427 remains unresolved. Source/docs
delivery is not release authorization: require independent audit, normal merge,
fresh exact-current-main readiness and all-seven registry/tag reconciliation,
then separate owner GO for one NEW attempt1 run. Never retry historical failed
runs. Historical NPM_UNKNOWN has no proven cause; blank environment is intended
configuration, not a retrospective diagnosis.

References: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/),
[GitHub OIDC](https://docs.github.com/en/actions/reference/security/oidc),
[RC policy](../scripts/release/RC-GATE.md),
[preflight and exception](../scripts/release/RC-PREFLIGHT.md).
