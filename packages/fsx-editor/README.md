# @formbar/fsx-editor

Presentation-only CodeMirror 6 extension: `fsxHighlighting()` consumes the
headless `analyzeFsxSyntax` service from `@formbar/fsx-authoring`. Inject it in
an editor's `extensions` array, including generic `@kalada/codemirror/editor`
hosts. It imports safely in Node without creating DOM objects.

Classes are `cm-fsx-tag`, `cm-fsx-attribute`, `cm-fsx-string`, and
`cm-fsx-punctuation`. Names are syntactic, not component or attribute admission.
Guest expression interiors remain unstyled. Malformed documents retain only
recognition before the first error, not speculative sibling recovery.

Every document edit or replacement recomputes bounded recognition synchronously;
no subscriptions, timers, or disposal hooks are installed. No completion, hover,
formatting, diagnostics UI, or compilation is provided.
