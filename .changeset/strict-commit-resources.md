---
"@formbar/core": minor
"@formbar/react": minor
---

Fix #160: defer hook-owned plugin and middleware initialization to committed React effects and release resources synchronously on StrictMode replay and unmount. The opt-in core factory leaves imperative `createForm` eager. Hook-owned stores now survive replay and are not permanently disposed on unmount; externally held APIs require explicit `dispose()` to fire `onDispose`.
