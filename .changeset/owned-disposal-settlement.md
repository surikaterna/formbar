---
"@formbar/core": patch
---

Settle a pending guarded submit as aborted when its form is disposed during async validation, without publishing late attempt metadata. Unsupported owned-state publications on live forms still fail closed.
