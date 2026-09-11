---
"@formbar/expressions": minor
"@formbar/core": minor
"@formbar/react": minor
"@formbar/arbiter": minor
---

Introduce the authorized reactive expression runtime powered directly by Kuery's
strict whole-AST expression core (#90, parent #60, contract coordination #61). Add authorized core namespace
adapters and form disposal notifications, the public reactive ordinary-prop React
hook, and an opt-in Arbitre operator that reads actual rule RHS scope. Derived
expressions stay read-only; direct bindings preserve core write/veto results and
reject stale capabilities. This does not add a declarative renderer or stored
computation scheduler. The new expressions package begins at 0.0.0 and joins the
coordinated linked release family; existing integration APIs are additive minor changes.

Harden the JSON boundary against holes disguised by non-index array properties;
parse expression/prop/scope shapes before constructing typed contracts. Contain
throwing or asynchronous lifecycle callbacks, finalize reentrant disposal, expose
bounded code-only lifecycle diagnostics, and consume supported ordinary native Promise
snapshot/target/callback results without enabling asynchronous providers.
Untrusted JSON rejects Promise objects structurally without touching Promise
accessors; trusted callbacks consume only descriptor-verified ordinary native
Promises and reject suspicious species shapes without observing them.
Plain JSON objects with data fields named `then` remain valid and are not
misclassified as callback Promise results.
