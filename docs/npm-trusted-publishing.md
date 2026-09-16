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

npm requires a package to exist before its trusted publisher can be configured. For
`@formbar/expressions`, an owner must first publish the changeset-produced `0.4.0`
tarball once with a short-lived granular token and provenance, then immediately:

1. Add the trusted publisher above to the new npm package.
2. Revoke the bootstrap token.
3. Run the normal `release.yml` workflow for all later releases.

Do not add the bootstrap token to GitHub Actions or change the workflow to token
publishing. This npm-side bootstrap is the only external release blocker.
