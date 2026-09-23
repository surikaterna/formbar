---
"@formbar/declarative": patch
---

Bound each concrete action queue to 32 waiting intents so a stalled host handler cannot retain unbounded pending executions.
