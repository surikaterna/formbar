---
"@formbar/core": minor
---

Add creation-time `ownedScheduling: true` for eager and deferred forms, including prepared schema and React factories. It validates and owns bounded JSON-compatible initial state before any initialization callback or render-visible snapshot; invalid direct writes reject before pipeline hooks, and invalid trusted callback output cannot publish. Trusted callbacks may still cause external side effects before their invalid output is detected at commit. Default forms retain existing behavior. Accepted writes replace the owned epoch while issue-only publications share it. The legacy trusted-host activation seam remains for existing integrations; caller-owned and prior snapshots remain unfrozen. No omission or release is enabled.
