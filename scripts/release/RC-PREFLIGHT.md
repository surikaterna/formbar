# #406 read-only bootstrap

`release.yml` fetches only the generated event's full SHA into an empty
repository with built-in shell/git, suppressing templates, hooks, global/system
config and redirects. Its temporary authorization header is used only for
fetch. It checks the clean detached HEAD and pinned SHA-256 of the checked-in
bundle before runner Node executes it, without installing dependencies. The
bundle uses only Node built-ins and local GET-only source/CI/policy verification;
no OIDC request or npm operation precedes this gate. The adapter repeats the
checks before each write. No GO comment or environment approval is consulted.
The current live reviewer rule causes fail-closed denial until admin removes it
**after** independent source audit and merge; no actual dispatch is authorized.

Bun 1.2.21 reproduces the bundle byte-for-byte (Bun 1.2.0 does not). Build:

```sh
mise exec bun@1.2.21 -- bun build scripts/release/rc-preflight-entry.ts --target=node --format=esm --bundle --outfile=scripts/release/rc-preflight.mjs
sha256sum scripts/release/rc-preflight.mjs
mise exec bun@1.2.21 -- bunx vitest run scripts/release/__tests__/rc-workflow.test.ts
```

Expected bundle SHA-256, also pinned in the workflow:
`a9e754e62421819b3e28626edcd9176877dfd68f63e8706ea415cb9dae4b27a7`.
CI rebuilds and compares bundle bytes. Source sections in bundle order:

```text
62d288331897879f62cb882712845c5b910b55d1a1cf105d67bfa96cf0bcabb6  rc-reviewed-plan.ts
4a4f20d3f6e1cdb24f5edd04df6b511d22fbe5bc0cf0137d61533e9da0e705fd  live-evidence-shape.ts
18f00e03812fff53033ed694d16611a941be406ea038c7ffe92b87268c822e28  github-read.ts
083114804db8fc853b7e423eb492386496b41129bb7cdce0e390efc152300431  live-policy.ts
e45c74178ef87a9f9e925150c338f3c299c311e5001baf6f2e7d675462742a79  live-evidence.ts
25c87aef56fbd654e4657520b0e0684eedd1c92b5cf9fa2dfe67ff1070932b94  rc-attempt-fence.ts (tree-shaken initializer)
cd10695bc0b12392491f250be9ba72de1f600e4e4983c7f61be1c41ad934430c  rc-registry-proof.ts (source check only)
49e339f5e88a55ac03dbcfc7507fc906e5f9a084bc0a533b74d51aa3ec33e1f7  rc-source-local.ts
78fce86c39d3bb283bc4a550effe2a00ac9be7ce40bfaaa0727db40c1328e371  rc-run-authority.ts (read-only verification)
1f3e584c7610eb971e21b862e058209b3c124d228464c099f0d693dd76b1d6fc  rc-preflight-entry.ts
```

Review the actual bundled import tree on every update. The generated bundle
is excluded from Biome and the 400-line handwritten source limit; this is the
only production-size exception. Job-level `id-token:write` exists from job
start: the no-request guarantee is code order, **not** an OS permission
boundary. The fence is runner-local and npm writes cannot be rolled back.
