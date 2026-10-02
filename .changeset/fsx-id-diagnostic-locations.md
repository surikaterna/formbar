---
"@formbar/fsx-authoring": patch
---

Explain missing, nonstatic, empty, unsafe/overlong, and duplicate element IDs with human-readable diagnostics. Duplicate IDs now include an optional structured `related` location pointing to the first declaration, with original UTF-16 source ranges. ID uniqueness, allowed identifiers, field ownership, and writer permissions are unchanged.

Compatibility note: ID errors now use `MISSING_ID`, `NON_STATIC_ID`, `EMPTY_ID`, `INVALID_ID`, and `DUPLICATE_ID` instead of the previous generic `MISSING_ATTRIBUTE`, `STATIC_STRING_REQUIRED`, `DUPLICATE_OR_INVALID_ID`, or admission `INVALID_IDENTIFIER` for these cases. Diagnostic codes remain strings; consumers should not infer locations from message text.
