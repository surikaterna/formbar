---
"@formbar/core": minor
---

Add optional callback parameters to the exported `FormStore.commitTransaction`, `runVetoHooksSync`, and `runNotifyHooksSync` signatures. The commit callback runs after a dirty state commit and before subscribers; the middleware callbacks checkpoint between synchronous hooks. These signatures support internal guarded submit preparation; this release does not enable a public guarded-submit opt-in.
