---
name: ansi-editor-maintenance
description: "Use when changing ANSI Workshop canvas rendering, CP437 palettes or export, unlimited-row sparse documents, keyboard editing, block operations, or undo/redo."
---

# Maintaining the ANSI editor

1. Read [architecture](../../../docs/ARCHITECTURE.md) and
   [project instructions](../../../AGENTS.md). Identify the affected invariant:
   sparse coordinates, byte encoding, transaction grouping, or cursor behavior.
2. Trace the relevant command from App through the model to rendering/export.
   Reuse existing cell validation, rectangle helpers, and transaction methods.
3. Add a regression test before changing behavior. For large-row behavior,
   use a few cells at billion-row coordinates, not a dense array.
4. Keep copy/clear/paste/flip sparse. Preserve colored spaces, blank-cell paste
   opacity, column clipping, and direction-sensitive glyph reflection.
5. For export changes, assert exact byte arrays and SGR sequences. A visible
   Unicode block does not prove a CP437 byte was written.
6. For save/history changes, test undo/redo branches and editing while a prior
   snapshot is being saved. Never mark later unsaved edits as persisted.
7. Run the relevant tests with `npm run test -- src/model.test.ts` (or the
   relevant test paths), then `npm run check`.
8. For UI changes, start the loopback server and check pointer dragging,
   arrows/F-keys, selection, preview updates, and scrolling in a real browser.
   Check for CSP violations and keyboard focus traps.
9. Update user/architecture docs for changed behavior and report actual
   validation results plus any native-dialog or terminal-compatibility limits.
