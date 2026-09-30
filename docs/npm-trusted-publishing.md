# Manual npm RC distribution

The active procedure is `.github/workflows/release.yml`, simplified under #442
and the owner policy supersession in #250 (comment 5913830240). Archived release
research is not a prerequisite. Main pushes only create Changesets version
proposals; they never publish.

## Operator steps

1. Audit the source PR and pass normal protected-branch CI before merge. Source
   delivery does **not** authorize publication; #250 remains release HOLD.
2. On a separate owner instruction, `spralle` starts a **new** manual run of
   `release.yml` on `main` in `surikaterna/formbar`. Never rerun historical failed
   runs (including 36723897550). No SHA/GO input or deployment environment is used.
3. The job checks out source, sets up Bun **1.2.21**, Node **22.23.2** and npm
   **11.20.0**, provisions the required offline test tools, then performs frozen
   install → sequential package build → full tests. All seven named manifests
   must share a well-formed `-rc.N` version (currently **0.23.0-rc.0**).
4. The job records each stable `latest` tag, queries each exact candidate version,
   and skips matching existing name/version pairs under npm immutability. Only a
   structured npm `E404` failure permits publication. Other errors stop the job.
   Absent candidates publish directly from package directories with
   `npm publish --tag rc --access public --provenance`, in this order:
   **expressions → core → declarative → from-schema → react → arbiter → react-schema**.
5. Review normal npm stdout/stderr and the final registry records: exact name and
   version must match, `rc` must equal the candidate, and `latest` must be unchanged
   for all seven. A mismatch or failure stops visibly. There is no failed PUT
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

Reference: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).
