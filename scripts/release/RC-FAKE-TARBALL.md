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
calls succeed. Fake 201/GETs, digest equality and the unsigned signer cannot
establish npmjs.com direct permission, propagation, real OIDC, signed
provenance or trusted source authority. There is no publish
sequencing method in this study. Seven real publishes would not be atomic;
partial or uncertain writes cannot be resolved by this fixture.

Negative checkpoints: an incorrect head/tree/base or a refreshed #298 head
fails `preflight` before packing or any fake PUT. A changed pre.json consumed ID,
manifest version or internal edge fails `checkPlan` before any fake PUT; a
modified checkout is also rejected as dirty. A mismatch between two prepack
byte buffers fails `packs`, and modification of a candidate tarball after pack
fails the byte read immediately before its CLI call. False rc/latest tags,
altered attachment bytes and failed/partial CLI calls throw instead of
printing the final verdict; earlier fake PUTs are not proof of completion.

#406 binds the exact protected main SHA/tree, first-attempt spralle run, live
policy and seven candidates without a GO comment or reviewer. It performs
fresh read-only #365/#371 observations before writes and genuine #374
verification after writes. This fake study never grants authorization;
public absence cannot prove npm publisher permission. #434 removes deployment
environment gates; the existing remote resource remains unused and unchanged.
Independent audit/merge, fresh readiness/admin readbacks and separate exact-main
owner GO remain required. No real publish is implied.
