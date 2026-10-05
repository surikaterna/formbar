# @formbar/fsx-authoring

## 0.1.0-rc.1

### Minor Changes

- Expose bounded parser-owned FSX syntax analysis and introduce presentation-only
  CodeMirror highlighting with unstyled guest interiors.

### Patch Changes

- b47bef6: Explain missing, nonstatic, empty, unsafe/overlong, and duplicate element IDs with human-readable diagnostics. Duplicate IDs now include an optional structured `related` location pointing to the first declaration, with original UTF-16 source ranges. ID uniqueness, allowed identifiers, field ownership, and writer permissions are unchanged.

  Compatibility note: ID errors now use `MISSING_ID`, `NON_STATIC_ID`, `EMPTY_ID`, `INVALID_ID`, and `DUPLICATE_ID` instead of the previous generic `MISSING_ATTRIBUTE`, `STATIC_STRING_REQUIRED`, `DUPLICATE_OR_INVALID_ID`, or admission `INVALID_IDENTIFIER` for these cases. Diagnostic codes remain strings; consumers should not infer locations from message text.

## 0.1.0-rc.0

### Minor Changes

- da0a748: Introduce the separate trusted FSX authoring compiler candidate. The experimental first-profile punctuation is not owner-frozen. This package is held from publication by #317; unpublished Kalada dependencies are installed only by the guarded test overlay.

### Patch Changes

- Updated dependencies [da0a748]
- Updated dependencies [da0a748]
- Updated dependencies [8e27ed2]
- Updated dependencies [ee71f85]
- Updated dependencies [abda3ac]
- Updated dependencies [8998ab4]
- Updated dependencies [eee4541]
- Updated dependencies [da5c817]
- Updated dependencies [4879fcc]
- Updated dependencies [ee9d850]
  - @formbar/declarative@1.0.0-rc.1
