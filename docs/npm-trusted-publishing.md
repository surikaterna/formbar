# Manual npm RC distribution

The active procedure is `.github/workflows/release.yml`, simplified under #442
and the owner policy supersession in #250 (comment 5913830240). Archived release
research is not a prerequisite. Main pushes only create Changesets version
proposals; they never publish.

## Operator steps

1. The owner authorizes all completed greenfield packages for publication, with
   no archived release ceremony. Independently audit the integration/workflow
   and pass normal production CI before merge. #317 still blocks this integration
   until the required Kalada releases are available and installed normally.
2. When those technical gates pass, `spralle` starts a **new** manual run of
   `release.yml` on `main` in `surikaterna/formbar`. Never rerun historical failed
   runs (including 36723897550). No SHA/GO input or deployment environment is used.
3. The job checks out source, sets up Bun **1.2.21**, Node **22.23.2** and npm
   **11.20.0**, provisions the required offline test tools, then performs frozen
   install → sequential package build → full tests. All nine named manifests
   must have well-formed `-rc.N` versions and a closed, compatible dependency graph.
   Changesets linked groups are not fixed groups: the public breaking switch gives
   declarative/from-schema/react-schema **1.0.0-rc.1**, FSX versions separately:
   authoring advances additively to **0.1.0-rc.1**, editor enters at
   **0.1.0-rc.0**, and the other four remain **0.23.0-rc.0** in this proposal.
4. The job records each `latest` tag (including its absence for new FSX), queries each exact candidate version,
   and skips matching existing name/version pairs under npm immutability. Only a
   structured npm `E404` failure permits publication. Other errors stop the job.
   Absent candidates publish directly from package directories with
   `npm publish --tag rc --access public --provenance`, in this order:
   **expressions → core → declarative → fsx-authoring → fsx-editor → from-schema → react → arbiter → react-schema**.
5. Review normal npm stdout/stderr and the final registry records: exact name and
   version must match, `rc` must equal the candidate, and `latest` must be unchanged
   for all nine; an absent `latest` must stay absent. Only `fsx-authoring` and
   `fsx-editor` may have absent initial package records or `latest` tags.
   A mismatch or failure stops visibly. There is no failed PUT
   retry, automatic tag repair, or GitHub tag/release requirement for RC npm tests.
   Investigate partial publication before requesting another new run.

## Authentication and limits

The intended existing npm trusted publisher is GitHub Actions, repository
**surikaterna/formbar**, workflow filename **release.yml**, environment **blank**,
with **direct npm publish** allowed. The job grants `contents: read` and
`id-token: write`; it uses OIDC with the normal inherited GitHub environment,
including public provenance metadata. No NPM_TOKEN, NODE_AUTH_TOKEN, generated
`.npmrc`, config scrub, or custom signed-package runner is added. Do not print
tokens or dump environment/configuration; standard GitHub masking still applies.

Source tests do not certify private npm publisher settings or future registry
acceptance. Matching existing versions are immutable skips, not custom signer
proof. Registry absence does not establish whether a historical PUT occurred.
No settings changes or mandatory admin-readback gate are part of this procedure.

**New-package authentication is unresolved:** npm trusted publisher configuration
for the existing seven does not prove first-publish capability for
`@formbar/fsx-authoring` or `@formbar/fsx-editor`. The owner may need an initial credential-based package
creation and then the package's trusted-publisher configuration. This workflow
does not add a token fallback or assume that OIDC can create a nonexistent npm
package. Any bootstrap must explicitly use `--tag rc --access public --provenance`
and preserve an absent `latest`; never silently fall back to stable publication.

Editor enrollment is code-only authorization, not authorization to publish or
change registry/authentication settings. Its dependency floor is
`@formbar/fsx-authoring@^0.1.0-rc.1`, the first RC containing the public syntax API.
The inspected Changesets plan versions only authoring and editor; the existing
authoring diagnostic patch is consumed together with the syntax minor by the
normal `bun run version:packages` command. The other seven manifests/changelogs
and historical seven-package reviewed contracts remain unchanged.

See [integration preparation and pending dependency ownership](release-fsx-integration.md).

Reference: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).
