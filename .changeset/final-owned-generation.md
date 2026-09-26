---
"@formbar/core": patch
---

Track the exact private guarded FINAL sync and foreground async generation transitions, including unscoped and zero-async candidates, so competing validation cannot masquerade as the same submit attempt. Default validation and submission behavior remains unchanged.
