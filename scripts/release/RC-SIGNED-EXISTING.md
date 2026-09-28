#374: disabled existing-version provenance check

This is a **read-only observation for an already published exact version**. It is
not wired to `release.yml` or #363 and cannot authorize a future upload, tag,
approval, OIDC exchange, or #298 merge. The expected identity must come from an
independently protected approved run, not npm metadata, `gitHead`, a URL, or
the public attestation itself. #250/#298 remain held.

#383 adds a **separate disabled** `verifyPrepackedSignedVersion` contract for
the empirically missing npm11 tarball-input `gitHead`. The original
`verifyExistingSignedVersion` also permits absent `gitHead` only after its
full authenticated signed provenance and downloaded-byte verification; the
prepacked contract additionally binds the expected local tarball bytes. A
present `gitHead` must still equal the independently approved protected main
commit. An absent
one is accepted only if the downloaded registry tarball SHA512 also matches
the supplied exact prepacked bytes and the authenticated signed SLSA subject,
certificate identity and signed repo/ref/commit/workflow/run/attempt all match
the approved run. Missing/changed prepack bytes, unsigned proof, unknown run
or mismatched present `gitHead` denies. Neither API is wired to a skip or a
publish. Only `createPinnedAudit` is the trusted verifier implementation;
injected test proofs simulate orchestration, never cryptographic authority.
The prepacked bytes must be independently produced from the exact reviewed
version tree with a pinned toolchain before this conditional path is used.

The optional test `rc-signed-live.test.ts` uses an isolated single top-level
exact `@changesets/cli@2.29.7` install, Node **22.23.2** and npm **11.20.0**.
Supply absolute paths `RC_SIGNED_NODE`, `RC_SIGNED_NPM_ROOT` (npm's package
directory), `RC_SIGNED_INSTALL` (isolated installed project). The scratch CLI
and target must be installed *outside* this repository, with `--save-exact
--ignore-scripts --no-audit --userconfig=/dev/null`, using a private cache and
`TMPDIR` on the home filesystem. The install may have transitive dependencies;
its root must have only the exact target. This test intentionally skips if
these three paths are absent; it is run explicitly before audit. Never replace
it with a mocked cryptographic-positive test.

`createPinnedAudit` checks both CLI and Node versions and the isolated root,
then runs `npm audit signatures --json --include-attestations` (nonzero/error
denies). It requires exactly one verified entry for the installed target and
matches **both complete bundle objects** to the separately downloaded same-host
attestation response; counts or an empty `invalid`/`missing` array alone never
count as proof. The signed subject of *both* registry publish and SLSA bundles
must be the exact npm PURL and SHA512 hex digest of the completed registry
tarball bytes (<=20 MB); exact metadata SRI and SHA1 must also match those
bytes. Version/full-packument/tag reads are repeated and redirects denied.
Adversarial injected reads reject 401/403/429/5xx and redirects at version,
packument, tarball and attestation boundaries; only a version GET 404 is
observed absence. A forged `dist.provenance` without `dist.attestations` is
unverifiable, regardless of its claimed identity. These tests use GET-only
transport injection and never write to the registry or request OIDC tokens.
The registry reader caps actual JSON bytes (2 MB), tarball bytes (20 MB), and
each request at 10s. `npm audit` is capped at 90s/8 MB output; Sigstore at
45s/60 KB bundle input. No arbitrary unbounded polling or missing-version
inference: an absent or delayed version is simply `UNVERIFIABLE`.

The pinned npm CLI verifies the downloaded in-toto PURL/SHA512 against
**metadata**, not independently downloaded bytes, and does **not** enforce the
expected publisher identity. Therefore `rc-signed-sigstore.cjs` independently
calls the Sigstore API shipped with the same pinned CLI, in Node, with trusted
TUF/Fulcio/Rekor/SCT/signing-time checks and an explicit identity policy.
No homegrown certificate parser is used: Sigstore's `certificateOIDs` API
compares authenticated DER values. The observed GitHub Fulcio certificate
contains issuer OID `.1`, SHA `.3`/`.10`/`.13`/`.19`, repo `.5`/`.12`, ref
`.6`/`.14`, workflow `.9`/`.18` and exact run URL including attempt `.21`;
the SAN and issuer are checked too. Signed SLSA GitHub Actions build type,
GitHub-hosted builder, workflow, resolved commit and invocation ID must agree.
This policy is **not** derived from unsigned
`dist.provenance` (there is no such field). The signer certificate need not be
valid *today* if it was valid at the trusted signing time.

Sanitized live reference (2026-09-28): @changesets/cli@2.29.7,
`sha512=47b46a5a86a4b32c8a5db2970536d3e1111dcb6db21fcd667052bab16b6a49a9f15026d48bd51ffba6aac59b43428b88a8f75e9b65b9e827715e0b3176aec52d`;
approved source `changesets/changesets`, workflow
`.github/workflows/changeset-version.yml`, `refs/heads/main`, commit
`8c065c4313e06e13ce48d6681aa9a253d69f655f`, run `17583250854`,
attempt `1`; five public GETs were 200, without redirects. No private keys,
tokens or raw bundle are logged or stored here. The regular negative fixture
uses this recorded wire shape and identities with explicitly **synthetic**
bytes/signatures: its positive only tests orchestration. The opt-in live test
is the genuine cryptographic-positive proof. It must be repeated by Auditor
against the exact pushed SHA; never treat an injected fake `AuditProof` as a
trusted production verifier.

The opt-in live test also runs the **pinned Sigstore certificate-chain verifier**
against the genuine Fulcio leaf and trusted TUF chain from the real bundle. It
first accepts the authentic integrated signing time, then tests a timestamp
one second after the leaf expiry with CA selection held fixed: the nested
`CERTIFICATE_ERROR` must be the verifier's *certificate is not valid or expired
at the specified date*, rather than a chain/path or stub error. This tests
the actual signing-time validity branch, not a purported cryptographically
genuine expired-at-signing bundle. Constructing such a full publicly trusted
bundle would require control of Fulcio signing and a valid transparency log
entry for a signing time outside its leaf validity; mutating its recorded
timestamp would invalidate Rekor's signed proof. No revocation check is
claimed (Sigstore's pinned API here validates chain/time/SCT/tlog, not a
revocation status service). A requirement for end-to-end revoked or expired
*publicly trusted* bundles needs an explicit risk decision before release use.

References: [npm CLI 11 audit signatures](https://docs.npmjs.com/cli/v11/commands/npm-audit/#audit-signatures),
[npm CLI 11.20.0 verification](https://raw.githubusercontent.com/npm/cli/v11.20.0/lib/utils/verify-signatures.js),
[pacote registry verification](https://raw.githubusercontent.com/npm/pacote/latest/lib/registry.js),
[Sigstore verifier policy](https://github.com/sigstore/sigstore-js/blob/main/packages/verify/src/verifier.ts).
