# Demo development

Install from the repository root with `bun install --frozen-lockfile`, then run
`bun run build` to prepare workspace package exports and `bun run dev` for Vite.

## FSX source editor

The private playground uses the published, pinned `@kalada/codemirror@0.2.0`
neutral `/editor` entry point with one pinned set of CodeMirror 6 peers. No local
artifact, package override, or unpublished registry version is required.

FSX source supports editing, undo/redo, and **Ctrl+Enter** (**Cmd+Enter** on macOS)
to compile and apply the current draft. The **Compile and Apply** button uses the
same application path. Compilation failures leave the last successful preview
running; diagnostic buttons focus/select the corresponding UTF-16 source range.
There is no FSX completion, formatting, syntax grammar, or whole-document Kalada
expression provider. Compilation remains an explicit host action.

Hardware shortcut coverage targets desktop browsers. CodeMirror's Android input
handling defers native Enter and does not preserve its modifiers; use the Apply
button there. The narrow Android-emulation project still checks paste/editing,
button application, diagnostics, copy/download, and layout.

Initial JSON remains a textarea. Source-only Apply retains live preview data;
editing initial JSON replaces it on successful Apply. **Copy active** copies the
last focused source or JSON editor, and download exports both unapplied drafts.
**Reset example** restores the original source, JSON, and preview.

## Browser regression checks

From `apps/demos`:

```sh
FORMBAR_DEMO_BASE=/formbar/ bun run test:e2e fsx-editor.spec.ts fsx.spec.ts fsx-replacement.spec.ts
```

If needed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a system Chromium binary.
Set `FORMBAR_PLAYWRIGHT_PORT` to a free port when another worktree uses the default
4173. Preview startup uses strict-port mode rather than silently testing a different
server. The tests build and launch this worktree's demo themselves.

This change affects only private demos, not publishable Formbar packages, so it
does not need a Changeset.
