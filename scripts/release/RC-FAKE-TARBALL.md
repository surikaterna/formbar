# #382 disabled tarball-input study

The held version PR #298 was observed OPEN at head
`6a1dfb495acc767736ac38915199bc0edb529709`, tree
`682382105ff0658083fbe229ad38a1d1957a14c4`, base
`5c267580b6928d91592ed6835b8c741a24b98df6`. This is a snapshot,
**not consent to merge**. Recheck `gh pr view 298` before repeating; every bot
refresh invalidates these bytes. Its seven `0.23.0-rc.0` packages have the
exact internal `^0.23.0-rc.0` edges in `rc-reviewed-plan.ts` and pre.json has
the 23 explicitly enumerated consumed IDs including `reference-codec`.

From a **separate clean disposable checkout** at that exact head, install via
`mise exec bun@1.2.21 -- bun install --frozen-lockfile`, then build with
`mise exec bun@1.2.21 -- bun run build`. From a separate clean feature worktree
containing this script, execute:

```sh
mise exec node@22.23.2 npm@11.20.0 -- node scripts/release/rc-fake-tarball-proof.mjs \
  /tmp/opencode/382-pr298-6a1dfb \
  6a1dfb495acc767736ac38915199bc0edb529709 \
  682382105ff0658083fbe229ad38a1d1957a14c4 \
  5c267580b6928d91592ed6835b8c741a24b98df6
```

The program checks live PR identity and clean Git checkout before and after
packing, and before each CLI invocation. Two native `npm pack --pack-destination
<isolated-dir> --json` invocations per package must yield identical bytes.
Node 22.23.2/npm 11.20.0 CLI publishes each explicit tarball with `--tag rc
--access public --provenance` **only** to an HTTP server bound to 127.0.0.1.
The child process has a fresh HOME/TMPDIR/cache, `/dev/null` userconfig,
no inherited tokens, and a socket boundary denying non-loopback connections.
The injected OIDC exchange and unsigned, fake statement are *not* GitHub/npm
tokens or trusted SLSA provenance; generation is intercepted before real
Sigstore traffic. The seven PUT attachment buffers, metadata SRI/SHA1, subject
SHA512 and fake-registry downloaded tarball are compared with the first pack;
tarball metadata gitHead is absent. No package defines pack/publish lifecycle
scripts; the tarball-input CLI path also skips directory publish lifecycle.

The study emits `UNVERIFIABLE`, not an authorization, even if all seven CLI
calls succeed. The fake server's 201/GETs cannot establish npmjs.com direct
permission, actual registry propagation, real OIDC or genuine signed identity.
`rc-tarball-sequence.ts` is an *inert* injectable fail-closed contract: it
stops after ambiguous PUT or changed tags/bytes; existing-version skips and
postwrite progression require the actual #374 signed, downloaded-byte verifier
and protected approved run identity. Its tests intentionally reject unsigned
fake proofs before any next write. Seven publishes are not atomic; a partial
or uncertain live write must be reconciled independently with NEW run-bound GO.
The dispatch workflow stays unconditionally rejecting. #363/#250/#298 are held.
