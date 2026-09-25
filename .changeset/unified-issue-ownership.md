---
"@formbar/core": major
---

Own validation diagnostics at every core store ingress. Mutable caller issues are validated, detached and deeply frozen as new stored values; core-produced scoped issues keep their original certified identity. Unsupported issue graphs now fail atomically instead of entering the store. This is a major compatibility bump because applications relying on `storedIssue === suppliedIssue`, mutable stored issue arrays, or previously accepted non-JSON issue details must migrate to reading the owned issue from `getState()` and supplying plain, dense JSON-compatible diagnostics. Public `normalizeIssues`, `sortIssues` and `dedupeIssues` remain non-owning utilities. Draft validation invocation and default retained-draft submission payloads are unchanged.
