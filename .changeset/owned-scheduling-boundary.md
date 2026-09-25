---
"@formbar/core": patch
---

Add a trusted-host opt-in boundary that detaches and freezes bounded JSON-compatible form state before scoped scheduling. Activation publishes one coherent new snapshot; accepted writes replace the owned epoch while issue-only publications share it. Unsupported opt-in state and custom strategies reject rather than falling back to mutable captures. Default forms retain their existing draft and submission behavior. Consumers opting in must use the newly published data/UI/policy references rather than relying on their pre-activation identities; caller-owned and prior snapshots remain unfrozen. No omission or release is enabled by this change.
