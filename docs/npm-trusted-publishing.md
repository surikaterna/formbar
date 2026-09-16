# npm trusted publishing setup

Formbar publishes packages from `.github/workflows/release.yml` with GitHub Actions OIDC and npm provenance.
Do not create or configure an `NPM_TOKEN` secret for this workflow.

In npm, add a trusted publisher for each public package:

- `@formbar/core`
- `@formbar/from-schema`
- `@formbar/react`
- `@formbar/react-schema`
- `@formbar/arbiter`
- `@formbar/expressions`

Use these settings for each package:

- Provider: GitHub Actions
- Repository owner/name: `surikaterna/formbar`
- Workflow filename: `release.yml`
- Environment: leave blank unless a GitHub environment is added later

The workflow grants `id-token: write` and sets `NPM_CONFIG_PROVENANCE=true` for `bunx changeset publish`,
allowing npm to verify the GitHub Actions run without `NODE_AUTH_TOKEN` or `NPM_TOKEN`.

## One-time bootstrap for a new package

`@formbar/expressions` is currently version `0.0.0` and is absent from npm. npm
requires the package to exist before its trusted publisher can be configured. Before
merging the feature or creating its version PR, an npm owner must:

1. From the reviewed commit, build, audit, and pack **only**
   `@formbar/expressions@0.0.0`.
2. Publish that exact tarball publicly under the non-default `bootstrap` tag using
   local npm authentication with a short-lived, package-scoped granular token. A
   local token bootstrap does not provide npm provenance; do not claim that it does.
3. Configure the new package's npm trusted publisher for repository
   `surikaterna/formbar`, workflow `release.yml`, no environment (matching the
   workflow), and allowed direct publishing.
4. Prove the OIDC configuration works, then revoke the bootstrap token and restrict
   token-based publishing. Do not remove the fallback before OIDC is proven.

The normal linked Changesets release can then publish all six packages at `0.4.0`.
Never manually prepublish `@formbar/expressions@0.4.0`: doing so would cause the
workflow's preflight, npm tag, and GitHub release metadata to skip or disagree with
the coordinated release. Changesets publishes the package sequence rather than an
atomic transaction, so monitor the complete six-package run and investigate any
partial publish before retrying.

If provenance is mandatory for the bootstrap itself, use a temporary npm-supported
cloud CI bootstrap and remove it after configuring the trusted publisher. Do not add
a permanent token or token-publishing path to the standard release workflow.
