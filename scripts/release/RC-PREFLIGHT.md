# #406 read-only bootstrap

`release.yml` fetches only the generated event's full SHA into an empty
repository with built-in shell/git, suppressing templates, hooks, global/system
config and redirects. Its temporary authorization header is used only for
fetch. It checks the clean detached HEAD and pinned SHA-256 of the checked-in
bundle before runner Node executes it, without installing dependencies. The
bundle uses only Node built-ins and local GET-only source/CI/policy verification;
no OIDC request or npm operation precedes this gate. The adapter repeats the
checks before each write. No GO comment, deployment environment REST endpoint,
environment name, branch policy or approval is consulted (#434).
The default GitHub OIDC subject is `repo:surikaterna/formbar:ref:refs/heads/main`;
the intended npm trusted-publisher Environment is BLANK. This is distinct from
the authenticated Fulcio SAN `https://github.com/surikaterna/formbar/.github/workflows/release.yml@refs/heads/main`.
Production verification still binds certificate OIDs and signed provenance to
the exact repository, workflow/ref/commit/run/attempt; no signing check is relaxed.
For the reviewed seven-package `0.23.0-rc.0` only, missing/null bypass actors
from the installation token are logged **UNVERIFIABLE**, never as empty. This
owner-approved exception depends on independent Auditor and Diplomat recording
fresh, dispatch-adjacent authenticated admin GET `bypass_actors: []` and exact
main SHA/tree, effective policy, unique green CI on #250 before any new first
attempt. The runner does not verify that external proof; missing or stale proof
means STOP. Explicit nonempty/malformed bypass and caller bypass still deny.
Postflight admin readback is required; #250 remains RELEASE HOLD, not a GO.

Bun 1.2.21 reproduces the bundle byte-for-byte (Bun 1.2.0 does not). Build:

```sh
mise exec bun@1.2.21 -- bun build scripts/release/rc-preflight-entry.ts --target=node --format=esm --bundle --outfile=scripts/release/rc-preflight.mjs
sha256sum scripts/release/rc-preflight.mjs
mise exec bun@1.2.21 -- bunx vitest run scripts/release/__tests__/rc-workflow.test.ts
```

Expected bundle SHA-256, also pinned in the workflow:
`50bfb5247297d325e94cbd307151004941f017cbe6d1c3805bb7d7b3716c6ae0`.
CI rebuilds and compares bundle bytes. Source sections in bundle order:

```text
62d288331897879f62cb882712845c5b910b55d1a1cf105d67bfa96cf0bcabb6  rc-reviewed-plan.ts
4a4f20d3f6e1cdb24f5edd04df6b511d22fbe5bc0cf0137d61533e9da0e705fd  live-evidence-shape.ts
18f00e03812fff53033ed694d16611a941be406ea038c7ffe92b87268c822e28  github-read.ts
26a74acccde1091b321927b21bf0b4ed8f68d3855a55f85baebf9045efd7a845  live-policy.ts
babcdddc96924cd206e0cb00b310c3d19af09ad82d01f1db8b02d79f430cec26  live-evidence.ts
25c87aef56fbd654e4657520b0e0684eedd1c92b5cf9fa2dfe67ff1070932b94  rc-attempt-fence.ts (tree-shaken initializer)
cd10695bc0b12392491f250be9ba72de1f600e4e4983c7f61be1c41ad934430c  rc-registry-proof.ts (source check only)
49e339f5e88a55ac03dbcfc7507fc906e5f9a084bc0a533b74d51aa3ec33e1f7  rc-source-local.ts
c1afb9f80765158c2ba47c8a012276c9f8fdc286d61050d45856fb01c48fb6bd  rc-run-authority.ts (read-only verification)
1f3e584c7610eb971e21b862e058209b3c124d228464c099f0d693dd76b1d6fc  rc-preflight-entry.ts
```

Review the actual bundled import tree on every update. The generated bundle
is excluded from Biome and the 400-line handwritten source limit; this is the
only production-size exception. Job-level `id-token:write` exists from job
start: the no-request guarantee is code order, **not** an OS permission
boundary. The fence is runner-local and npm writes cannot be rolled back.
