# ANSI Workshop

A local-only, keyboard-friendly ANSI art editor built with React, TypeScript, Vite,
and Node.js tooling. Inspired by the workflows of classic BBS art editors; no
code or assets from those editors are included. The bundled IBM VGA font
reproduction is separately licensed; see Font credits below.

**[Open the hosted static editor](https://wood-commits.github.io/ansi-workshop/)**
or browse the [GitHub project](https://github.com/wood-commits/ansi-workshop).
Editing and file access remain in your browser; the hosted version has no
uploads or automatic persistence. Agent access requires the local app.

## User guide

Start with the [illustrated user guide](./docs/USER-GUIDE.md) for a first drawing,
tool walkthroughs, keyboard shortcuts, block editing, and opening/saving files.

## Run locally

Use Node.js 24+ (Node 26 was used for initial verification) and npm.

```powershell
npm ci
npm run dev
```

Open **http://127.0.0.1:5173** in Chrome or Edge for native file saving.
The development server binds to loopback only. Do not expose it through a
tunnel, reverse proxy, LAN binding, or port forwarding.

For the production build, without development hot reload:

```powershell
npm run build
npm run preview
```

Open **http://127.0.0.1:4173**. Keep the terminal running while using the app.
Both supplied servers apply security headers; opening the built HTML directly
or serving it with another server is not equivalent.

The browser build in `dist` is self-contained: scripts, styles, font bitmap,
and the full font license/notices are bundled locally, with relative asset URLs
that also work under a static host's project subdirectory (such as GitHub Pages).
Deploy the entire `dist` directory, not the Node-only `build-mcp` output.
The production HTML includes a restrictive Content Security Policy before its
scripts/styles, plus `no-referrer` metadata. These protections work without
custom response headers; development keeps its separate HMR-compatible policy.
Use HTTPS and enable GitHub Pages' **Enforce HTTPS** option when deploying.
Editing and file access still happen only in the browser; hosting does not
add uploads, accounts, persistence, or a backend.

GitHub Pages cannot ordinarily configure project-specific response headers.
HTML cannot supply the anti-embedding `frame-ancestors` directive, MIME
`nosniff`, or camera/microphone/geolocation Permissions Policy. Those require
a host that supports response headers for parity with local preview.
See [static hosting limitations](./SECURITY.md#static-hosting) for details.
Agent access remains supported only on the existing local editor origins,
not GitHub Pages; use the local app for agent workflows.

### GitHub Pages deployment

The [Pages workflow](./.github/workflows/pages.yml) checks pull requests and
pushes to `main` using Node.js 24 and `npm ci`. Lint, all regression tests,
the production build, SAST, and the dependency audit must pass before publishing.
Only `dist` is uploaded; the Node broker and MCP build are not deployed.
CI allows 15 seconds per test for CPU-heavy canvas UI workflows on shared
runners; local tests retain Vitest's five-second default.
Actions are pinned to commit SHAs and deployment uses GitHub's short-lived
workflow token, not a stored personal access token.

In the repository's **Settings > Pages**, choose **GitHub Actions** as the source.
A push to `main` or a manual workflow run then deploys the site. Enable
**Enforce HTTPS** and check the deployment URL in the workflow's `github-pages`
environment. Pull requests run checks but cannot deploy. See the
[static hosting limitations](./SECURITY.md#static-hosting) before publishing.

### Source licensing

The editor code is distributed under the [MIT license](./LICENSE).
**Help > About ANSI Workshop** displays version **0.2**, the project and hosted
editor links, the complete MIT license, and the font license and attribution.
The About version follows the major/minor version in `package.json`.
The bundled source font and derived bitmap remain under their separate
[CC BY-SA 4.0 license](./src/assets/fonts/LICENSE.txt), with
[attribution and notices](./src/assets/fonts/NOTICE.txt).
Bundled ANSI example artwork and reference images are included with the project
owner's redistribution permission; the editor's MIT license does not relicense
those third-party assets.

### Release 0.2

Version 0.2 adds TundraDraw RGB editing, SAUCE metadata viewing/editing,
half-block drawing, ASCII copy export, experimental Ansimation transitions,
and scrolling from the VGA preview.

Download the [GitHub release](https://github.com/wood-commits/ansi-workshop/releases/tag/v0.2)
for the source archives or the static-build ZIP and its SHA-256 checksum.
The ZIP contains the contents of `dist` at its root, plus the editor license
and font notices. Upload the entire extracted directory to an HTTPS static
host; it works at the site root or under a project subdirectory.
It is not a desktop installer and should not be opened through `file://`.
For local use, download the source archive and follow Run locally above.
See [static hosting limitations](./SECURITY.md#static-hosting) for protections
that require host-configured response headers.

## Editing

All drawing tools have labeled, built-in vector icons and distinct matching
mouse cursors on the main canvas. Each cursor has a black/white outline for
contrast and a small crosshair marking the exact click point. The VGA preview
keeps its navigation cursor. No external icon fonts or network assets are
required. The bundled SVG favicon matches the header's
green three-quarter-block brand mark. Tool options have a dedicated row so switching
tools does not shift the canvas. Open, Save, and Save As are in the File menu;
their canvas keyboard shortcuts remain available.
Click a menu heading to open it, then hover another heading to switch menus
without another click. Hovering with all menus closed does not open one.

- **Canvas:** 80 columns by default, with no configured document line limit.
  **Settings > New/Open columns** accepts 1-512 columns for the next document;
  it never resizes existing art. Open uses a valid SAUCE width when present,
  otherwise this setting. Click
  and drag to paint the selected CP437 character; skipped pointer positions are
  interpolated. Choose Erase to restore default blank cells. The canvas has no
  cell grid overlay; the column ruler and row numbers provide position guides.
  A thin right-edge border marks the document's last column.
- **Draw modes:** Full Block is the default and retains selected-character
  drawing. Choose Half Block in Draw's Mode selector to draw at half-row
  resolution using only upper/lower CP437 half blocks with the selected FG/BG.
  This mode ignores the brush glyph and does not use left/right halves or
  slope-based alternation.
  Opposite halves with matching FG/BG merge into full blocks; retracing them
  keeps them full. Other glyphs or different colors are replaced with the new
  half block and selected background. Each drag remains one undo step;
  keyboard typing and F-keys are unchanged. The mode survives tool switches
  and New/Open, but resets on reload.
- **Recolor:** click and drag across existing art to apply the current foreground
  and background colors without changing any CP437 characters. Blocks, shading,
  text, and colored spaces keep their glyphs; default blank cells stay untouched.
  Skipped pointer positions are interpolated, and each drag is one undo step.
  Alt+click only positions the cursor; keyboard editing and preview navigation
  keep their usual behavior.
- **Settings:** choose IBM VGA 8x16 (the default) or Consolas, and independently
  choose Pixel perfect (8x16, the default), 1.25x (10x20), or 2x (16x32) cells.
  Pixel perfect and 1.25x adjust their visible row count to the available
  canvas height. The container fits complete rows with no blank strip below
  the line-number gutter; the keyboard focus outline stays inside the canvas
  so it is not clipped. 2x reserves enough height for a terminal-style 80-column,
  25-row view; shorter windows scroll the page to reach the controls below.
  The parent layout accommodates all 80 columns at 2x on wide browser windows.
  Smaller windows scroll horizontally without shrinking the art; the column
  ruler stays aligned. The selected font also applies to the VGA preview,
  function-key palette, all-characters drawer, and brush sample.
  Settings survive New/Open, but reset on reload; no preferences or art are
  automatically persisted. Changing display settings does not edit the document.
  **Character width** independently selects 8px (default) or VGA-compatible 9px:
  IBM glyphs keep their original eight pixels, with the eighth pixel repeated
  in column nine only for CP437 192-223. Other glyphs have a blank ninth pixel.
  The chosen width scales with zoom and applies to both canvases and glyph samples.
  Consolas fits the selected cell width using its system-font renderer.
- **Primitives:** choose Primitive, then Rectangle, Circle / ellipse, Rounded
  rectangle, or Star, with Filled or Outline style and Draw or Subtract mode.
  Drag to size the shape.
  The current foreground/background colors are captured when the drag starts;
  shapes always use Blocks & shading's full and half blocks (F4-F8), regardless
  of the selected brush or character palette. Half blocks soften curved and
  rotated edges; empty areas and outline interiors leave existing art untouched.
  Curve fitting omits tiny corner slivers instead of forcing a mismatched half
  block, avoiding scalloped edges at particular drag sizes.
  A live preview appears on both canvases without modifying the document.
  Release the pointer to place the shape as one undo step. Escape, canceled/lost
  pointer capture, or focus loss discards it. Other canvas shortcuts and wheel
  scrolling pause during placement.
  Hold Alt **after starting the drag** and move left/right to rotate around the
  shape's center (one degree per screen pixel); sizing freezes while Alt is held.
  Release Alt and move to resume sizing. Rotation respects VGA's 1:2 cell
  proportions, and rotated shapes clip at the document's left/top/right edges.
  An unrotated ellipse is a circle when its width in columns is twice its height
  in rows. Alt+click before a drag still only positions the cursor.
  **Subtract** previews the positive cut shape in the captured foreground color
  on both canvases, then removes it from existing art on release as one undo
  step. Filled removes the interior; Outline removes only the outline.
  Fully covered cells become default blanks. Half-block cuts retain the
  opposite half in its original visible color, promoting an original background
  color to foreground when necessary; removed pixels become default black,
  regardless of the selected FG/BG. Preview colors never color the result.
  CP437 cannot represent quarter-block remnants or partially clipped text/shading:
  those affected cells are cleared completely for a clean cut. Colored spaces
  and uniform-color cells can retain an exact surviving half. Cancellation
  leaves art/history unchanged; subtracting over blank space adds no undo step.
- **Paths:** choose Path and Fill or Subtract. Click to add corner nodes;
  click-drag a new node to create mirrored cubic Bezier handles. Click the first
  node or Close path to close the outline. Closing does not apply it: nodes and
  circular handles remain individually draggable until Finish path or Enter.
  Finish also closes an open path. Select a node by clicking it or using the
  Node selector; Delete node, Delete, or Backspace removes the selected node.
  Make curve creates smooth mirrored handles; Make corner collapses them.
  Deletion preserves closure with at least three nodes, otherwise reopens the
  path. Escape/Cancel discards the draft. Switching tools discards unfinished paths.
  Closed paths preview the result on both canvases using current FG/BG.
  Fill fits full/upper/lower/left/right blocks to the interior, ignoring the
  brush glyph. Subtract visits existing art only, cuts to the selected BG,
  and fits surviving colors to blocks; partially clipped text/shading is a
  bitmap-based approximation, not exact glyph clipping. Self-intersections use
  even-odd filling. Finish is one undo step; drafts are not exported or saved.
- **Position cursor:** choose Cursor, then click a cell to move without painting.
  Or hold Alt and click with any tool to reposition without switching tools.
  Cursor-only clicks clear the selection without changing art or undo/redo history.
  Dragging after a cursor-only click does not paint or select; typing and F-keys
  still work normally at the new position.
- **Move shapes:** choose Move, click any painted cell, and drag to reposition
  all side-connected painted cells, regardless of color or glyph. Colored
  spaces move too; diagonal-only neighbors and disconnected art stay put.
  Both canvases preview the move without changing the document. The whole
  shape stops at the canvas's left/top/right and safe-coordinate boundaries
  rather than being clipped. Release overwrites only the shape's destination
  cells, leaving holes untouched, and clears its original cells as one undo
  step. Undo also restores overwritten art. Escape, pointer cancellation/lost
  capture, or focus loss cancels; clicking without moving changes nothing.
  Keyboard commands and wheel scrolling pause during the drag. Alt+click still
  only positions the cursor, and the VGA preview retains click-to-position/
  drag-to-select behavior.
- **Gradients:** choose Gradient, then Linear or Radial. Start on an existing
  painted cell and drag a line from foreground toward background. Only
  side-connected cells matching the starting cell's foreground and background
  are shaded, treating full blocks, half blocks, and F1-F3 shades as one shape
  family. Other glyphs require an exact glyph match; other art is untouched.
  Linear projects along the line; radial uses its start as the center and its
  length as the radius, in VGA proportions. The whole matching region is filled, extending endpoint
  colors beyond the line/radius. F1-F4 block shades are staggered with ordered
  dithering; both solid endpoints use full blocks with the endpoint color as
  foreground, never background-only spaces or bright backgrounds.
  Half-block edges retain their glyph and original background, with their solid
  foreground set to the nearer gradient endpoint color (FG before the midpoint,
  BG from the midpoint outward). This preserves the shape's silhouette.
  Both canvases show a live preview and a line guide. Release places one undo
  step; Escape, pointer cancellation, or focus loss discards it. A click without
  a line changes nothing. Alt+click still positions the cursor.
- **Fill:** choose Fill and select its behavior. Recolor shape uses the selected
  foreground color on a matching connected region, using the same color and
  block-family matching as Gradient. Shading becomes solid full blocks; half
  blocks, text glyphs, and original backgrounds stay intact. Fill enclosed blank
  area paints only default blank cells inside a closed outline with full blocks
  in the selected foreground color (not the brush glyph or selected background).
  Stored cells, including colored spaces and half blocks, are whole-cell barriers.
  The outline must be closed on all sides: an area reaching the canvas's
  top/side edges or a completely empty row is rejected without changing art.
  One click is one undo step; dragging does not fill additional regions.
- **Eyedropper:** click a canvas cell to copy both its foreground and background
  colors. The brush glyph, art, modified flag, and undo/redo history are unchanged.
  A default blank samples Light gray / Black. The tool stays active; drag
  movement does not sample more cells. With Fill or Eyedropper selected,
  Alt+click still only positions the cursor, keyboard editing remains available,
  and the VGA preview keeps its usual click-to-position/drag-to-select behavior.
- **Keyboard:** focus the canvas, then use arrows, Home/End, Page Up/Down,
  Enter, Backspace/Delete, or type printable CP437 text. Column and row numbers
  in the bottom status bar are one-based.
- **Function keys:** F1-F12 place the corresponding palette glyph and advance
  the cursor. Switch the Character set selector to change the mappings.
  Clicking a palette tile selects the mouse brush without placing it.
  Some browser/OS-reserved F-keys may require a keyboard Fn modifier or cannot
  be intercepted; the clickable palette is always available.
  Blocks & shading uses the classic order: F1 light shade (176), F2 medium
  shade (177), F3 dark shade (178), F4 full block (219), F5 upper half (223),
  F6 lower half (220), F7 left half (221), F8 right half (222), F9 square
  (254), and F10 middle dot (250). F11/F12 are unassigned in this set.
- **All characters:** expand the drawer to select every byte from 32-255:
  printable ASCII, CP437's house at 127, and the extended block/line/symbol set.
  Control bytes 0-31 are deliberately unavailable as brush characters.
- **Colors:** classic ANSI uses 16 foreground and eight background colors.
  Choose **Settings > New/Open ANSI mode > iCE Colors** before New/Open for
  16 background colors, including color swapping and Ctrl+arrow cycling.
  Open detects the iCE bit in SAUCE automatically; files without SAUCE use
  the selected mode. iCE interprets SGR 5 as steady background intensity,
  never animated blink, and SGR 25/reset removes that intensity.
  Classic mode still rejects blink and bright backgrounds.
  With the
  canvas focused, Ctrl+Left/Right cycles the foreground backward/forward and
  Ctrl+Up/Down cycles the background backward/forward. Both wrap around without
  moving the cursor or modifying existing art. The swap button exchanges colors;
  a bright foreground becomes its non-bright base color when moved into the
  background (for example, Yellow becomes Brown), with a status notification.
- **Long documents:** drag the scrollbar beside the canvas for quick scrolling,
  click its track to move one page, use the wheel/page buttons, or enter a
  one-based row number in Go to row. The scrollbar covers painted rows plus
  three blank pages beyond the art or current viewport, expanding as you
  navigate farther; its range stays fixed during a thumb drag. Scrolling does
  not move the cursor or edit art. A focused scrollbar supports arrows,
  Page Up/Down, Home, and End. Only visible rows are rendered; there is no
  enormous DOM element or browser-height-dependent document limit.
- **Blocks:** toggle Select, then drag; Shift+arrows also extends a selection.
  Hold the pointer above or below the canvas while dragging to scroll and
  extend the marquee beyond the visible rows. Moving farther outside scrolls
  faster. Return inside to pause scrolling, or release to finish the selection.
  Edit contains copy, cut, paste at cursor, horizontal/vertical flips, delete,
  and deselect. Paste is opaque, including blank cells, and clips at the document's last column.
  Flip operations mirror recognized directional glyphs as well as positions.
  The clipboard is internal to this page, not the operating-system clipboard.
- **Undo/redo:** each pointer stroke or block action is one undo step.
  Ctrl+Z undoes; Ctrl+Shift+Z or Ctrl+Y redoes (Cmd on macOS).
  These work with the canvas, preview, toolbar, or menus focused, but leave
  text fields, select controls, and dialogs to their native keyboard behavior.
- **VGA preview:** Window shows/hides a live 640x960 backing canvas displayed
  at thumbnail size, using 8x16 cell proportions. It shows 60 rows starting
  at the main viewport's top row, not a squeezed image of the whole document.
  Focus the preview to wheel-scroll both viewports, or use its scrollbar.
  Its track and Page Up/Down keys move by 60 rows without moving the cursor
  or editing art; scrolling pauses during live shape placement.
  Click the preview to move the cursor without painting, or drag to select a
  block regardless of the active tool. Cursor/selection overlays stay synchronized
  with the main canvas. Drag above/below the preview to auto-scroll; the main
  canvas reveals the final cursor position when the gesture ends. The preview
  supports the same keyboard shortcuts, including copy, delete, and undo.
- **Menus:** only one application menu opens at a time. Click its heading again,
  choose an enabled command, press Escape, click outside the menu bar, or move
  focus outside it to dismiss. Escape returns focus to the menu heading.

Canvas shortcuts also include Ctrl+S, Ctrl+Shift+S, Ctrl+N, Ctrl+C/X/V,
Ctrl+A (select through the last nondefault row), and Escape (deselect/draw).
Cmd can substitute for Ctrl on macOS. Shortcuts intentionally do not intercept
typing in the row field or color/palette controls.

## TundraDraw (24-bit RGB)

Choose **File > New TundraDraw…** to start an RGB document using New/Open columns (default 80), or
**File > Open** to select a `.tnd` file. TundraDraw uses binary CP437 and
24-bit RGB foreground/background colors, not 16-bit color or ANSI truecolor
escape sequences. Classic `.ans` documents retain 16 foregrounds, eight
backgrounds, and their existing ANSI compatibility restrictions.

The TundraDraw sidebar offers RGB pickers, all 16 classic color presets for
both inks, and a compact swatch grid with **User Defined** and **Currently Used**
tabs. User Defined holds up to 64 saved colors with optional names; saving a
swatch again replaces its name. Hover, focus, or click a swatch to see its
name and FG/BG actions; user-defined swatches also offer Remove. Tab moves
through swatches/actions, arrow keys switch collection tabs, and Escape
closes a swatch's actions. Currently Used derives colors from the current art,
including colored spaces and undo/redo, displaying 64 at a time.
Swatches are session-memory-only:
New, Open, or reload clears them, and `.tnd` does not store swatch names.
Ctrl+arrows cycle the classic presets; swapping RGB inks does not reduce colors.

Draw, half blocks, keyboard editing, block operations, fill, gradients,
eyedropper, and both canvas fonts/previews support RGB colors.
Save/Save As writes `.tnd` using the same authorized native-file or explicit
download lifecycle as ANSI. Save As ASCII remains a separate colorless copy.
SAUCE00 Character/TundraDraw metadata is preserved and editable. SAUCE flag
bits (including the legacy iCE bit) are retained but do not control RGB colors.
Agent access and experimental Ansimation support only 80-column classic ANSI documents.

New and Ctrl+N retain TundraDraw mode; otherwise they use New/Open ANSI mode.
**New ANSI…** in a TundraDraw document uses the selected ANSI mode.
Opening `.ans` uses SAUCE mode/width or the New/Open choices.
These commands start/replace documents, not lossy color conversions.
Pasting an RGB block into ANSI fails visibly, before changing the destination,
if its colors cannot be represented by the classic palette.

Tundra24 records use the version/signature `24` + `TUNDRA24`, big-endian
32-bit row/column positions and four-byte color fields whose low three bytes
encode RGB. The unused high byte is ignored on import and written as zero on
export. Sparse row
gaps use position records, not dense blank output. The editor still has no
configured line limit, but `.tnd` positions must fit an unsigned 32-bit row;
export outside that format boundary fails explicitly. Only glyph bytes 32-255
and zero-byte skips are supported. A record-boundary DOS EOF byte ends the art;
only padding spaces and repeated EOF bytes are accepted afterward, not painted
as extra rows. EOF-valued bytes inside RGB records remain color data.
Malformed/truncated records, control glyphs,
positions outside the selected columns and unsupported SAUCE types
fail without replacing the current document.

## Open saved ANSI files

Choose **File > Open**, or press **Ctrl+O** with
the canvas focused. Select a local `.ans` file. Chrome/Edge use a native open
picker; other browsers use a standard file input. Files are read in the
browser, never uploaded or opened through a server filesystem endpoint.

Opening warns before replacing unsaved work. The current document stays
intact until the entire file has been read and validated; cancellation and
unsupported/malformed input do not replace it. Reading is streamed and can be
canceled. If you edit while opening, a second confirmation protects those
latest changes. A successful open resets the cursor, viewport, selection,
undo/redo history, and agent approvals, and starts with an unmodified document.

Files saved by this editor round-trip raw CP437 bytes, all 16 foregrounds,
eight backgrounds (16 in iCE mode), colored spaces, row gaps, and the selected width. The importer also
supports CRLF and LF-only newlines, tabs/backspace, document-width deferred autowrap
(including explicit enable/disable with `?7h`/`?7l`), ANSI SGR reset,
bold/normal intensity, default and supported indexed colors, cursor movement
(`A`-`G`, `H`, `f`, `d`), cursor save/restore (`s`/`u`), line erase (`K`), and
clear display (`2J`, with the default background). Rows remain sparse with no
configured line cap; the editor's safe-integer precision boundary still applies.
Compressed cursor-forward gaps after the last column follow DOS autowrap onto the
next row. A bare LF after a full-width row adds a newline after that wrap;
CRLF cancels pending wrap, keeping the editor's saved files stable on reopening.

This is not a full terminal emulator or UTF-8 importer. Unsupported controls,
blink (SGR 6, or SGR 5 outside iCE mode), extended bright backgrounds (SGR 100-107),
256-color/truecolor, and other display erase modes
cause a visible error instead of silently losing features.
Trailing DOS end-of-file bytes (including repeated EOF padding) are accepted;
other data after EOF is rejected. SAUCE00 trailers and their optional
comments are accepted for static ASCII/ANSI art with 1-512-column or unspecified
width. **File > SAUCE…** views, adds, edits, or removes the title, author, group,
date, and comments. Apply is one undoable edit; Cancel leaves metadata unchanged.
ANSI saves preserve metadata and font/display hints without applying them to
the canvas. ASCII and animation copies omit SAUCE. Malformed trailers, other SAUCE file types,
and widths outside 1-512 are rejected. SAUCE row counts do not allocate rows or
limit the sparse document.

SAUCE text uses CP437, with limits of 35 bytes for title, 20 each for author/group,
and 255 comment lines of 64 bytes each. Dates are YYYYMMDD or blank.
Invalid edits fail visibly rather than being truncated. File size and dimensions
are recomputed on save; heights beyond 65,535 rows use an unspecified height.
SAUCE's 32-bit file-size field limits metadata-bearing output to 4 GiB minus
one byte of ANSI content; remove SAUCE to stream larger classic 80-column files.
Saving iCE or non-80-column art automatically includes a SAUCE record describing
mode/width, even when descriptive metadata is absent or removed.
Such files retain the SAUCE file-size limit. Tundra saves also include a width
record when the width differs from 80. ASCII copies do not retain mode/width hints.

When opened through the native picker, **Save** targets that browser-authorized
file; the browser may still require write permission. File-input fallback
grants read access only: **Save** first asks for a destination where supported,
or requests a download. **Save As** always chooses a new destination.

## Save / Save As

**Chrome/Edge:** File > Save As opens the browser's native save dialog. Choose
the desired directory and an `.ans` filename. First Save also opens the picker;
later Save writes to that same browser-authorized file. The app has no directory
listing or arbitrary-path filesystem API. Picker cancellation is harmless.

**File > Save As ASCII…** saves a separate `.asc` copy containing raw CP437
characters and CRLF newlines, without ANSI escape codes or colors. Blocks,
shading, and box drawing retain their CP437 bytes; this is not strict 7-bit
ASCII or UTF-8. The current document name, ANSI save destination, and modified
indicator are unchanged. Use normal Save to preserve your colored artwork.
ASCII copies use the same native picker or bounded download mode described below.

**Other browsers:** Save requests a download. The browser's own preferences
control the directory (enable "ask where to save" where supported). A download
request is not proof of disk delivery, so it does not clear the modified flag.
The fallback refuses files larger than 64 MiB with an explicit error; use
native Save As for streamed files without that fallback size cap.

**VS Code integrated browser / Electron:** native picker APIs may be exposed
but file-handle reads and writes are blocked by the host. The editor uses
download saving and file-input opening in these browsers, without retaining a
writable handle. Open the same local URL in standalone Chrome/Edge for native
Save / Save As. There is no autosave; save your art before switching browsers.

Native saves stream bounded byte chunks, support cancellation, and report disk
or permission errors. Editing during a save is allowed: only the captured
document version becomes saved. Navigation, New, and Open warn about unsaved work.
**There is no autosave or recovery storage:** save before closing the page.

### File compatibility

Output is raw **CP437 bytes**, not Unicode/UTF-8, with ANSI SGR colors,
CRLF line endings, an initial reset/clear/home, and a final reset. Blank row
gaps are streamed as CRLFs, so files are sequential BBS screens rather than
viewport-clamped cursor-down sequences. Default trailing blanks and rows are
omitted; background-colored spaces are retained. Empty screens export just
the reset/clear sequences.

Foreground uses SGR 30-37 and 90-97; background uses SGR 40-47.
Traditional DOS/BBS attributes provide 16 foregrounds and eight backgrounds,
with the high background attribute bit used for blink. Bright backgrounds exist
in extended ANSI (SGR 100-107), and iCE color rendering can repurpose the blink
bit for background intensity. Optional iCE mode exports SGR 5/25 with base
background codes, not SGR 100-107. An ordinary terminal may display these
as blink; use an iCE-compatible viewer. The editor never animates blink.
Very old BBS terminals may also differ in bright-foreground SGR
support; test on the intended BBS. The viewer must interpret bytes as CP437 and
use the document's configured column count. Preview does not emulate a terminal's scrolling or
autowrap quirks.

IBM VGA uses a bundled, CP437-indexed bitmap derived from Web437 IBM VGA 8x16.
Every glyph, including mixed box lines, is drawn from the same bitmap without
using a browser text/font rasterizer. Native 8x16 and 2x 16x32 have identical
glyph pixels across browsers in the canvas backing image. 1.25x (10x20) uses
deterministic nearest-neighbor enlargement: source pixels have uneven widths
and heights at this fractional scale.
The original font's upper/lower blocks split 16 scanlines into 7 and 9, not
8 and 8. This is preserved for fidelity; primitive/subtraction operations
retain their logical half-cell geometry and CP437 glyphs.

Consolas preserves the former rendering: geometric blocks, shading, and basic
box lines, with text/other symbols drawn using installed Consolas, Courier New,
or monospace fallback. Its text pixels depend on the browser/platform, even
with native-sized cells. No system-wide font installation is required.
Pixel guarantees concern IBM art glyphs, not system-font gutter labels or UI
overlays. Browser zoom, OS/display scaling, and the reduced preview thumbnail
can rescale physical screen pixels; no web app can guarantee those are unchanged.

### Font credits

Web437 IBM VGA 8x16 from **The Ultimate Oldschool PC Font Pack v2.2** by
[VileR](https://int10h.org/oldschool-pc-fonts/) is used under
[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).
The source WOFF is unmodified. Our derived bitmap changes storage/indexing,
not glyph designs, and is distributed under the same license.
See [font notices](./src/assets/fonts/NOTICE.txt) and the
[full license](./src/assets/fonts/LICENSE.txt); these credits are also available
in the **IBM font license and notices** dialog in Settings. The dialog includes
both complete texts without fetching a text file or opening another tab.
The text assets live under `src` so Vite can bundle their raw contents in both
development and production; the unmodified source WOFF remains in `public/fonts`.
Close or Escape dismisses it and returns focus to Settings.
The font license does not change the license of the editor's
own code or impose a license on exported ANSI art, which contains no font data.

`npm run font:generate` regenerates the checked-in bitmap using only Node's
built-in modules. It validates the bundled WOFF's SHA-256 and whole-pixel
outlines; it does not download fonts, install packages, or use browser rasterization.

## Approved agent drawing (MCP)

Agent access is **off by default**. The official MCP SDK provides a local stdio
server, backed by an optional loopback-only broker. There is no public/network
MCP endpoint and no file-saving capability for agents.

See [the MCP setup and security guide](./docs/MCP.md) for the full workflow:

1. Keep the editor running and start `npm run agents` in a separate terminal.
2. Expand **Agent access** in the editor. Paste the broker's owner key and enable
   access. **Never give the owner key to an agent.**
3. Enter an agent label, click **Approve & issue token**, and confirm access to
   read/overwrite the current document.
4. Configure the intended MCP client with that separate agent token. The included
   [VS Code configuration](./.vscode/mcp.json) prompts for it privately.
5. Revoke individual agents or **Disconnect & revoke all** at any time.

Tokens expire after 30 minutes. New/Open documents, disconnects, missed editor
heartbeats, or a broker restart invalidate approvals. Anyone holding an agent
token can act as that grant: labels are for your reference, not verified model
identities. Approved agents can read art, so also consider their provider's data
handling before granting access. All drawing is undoable; agents cannot save.

## Checks

```powershell
npm run test                 # Vitest model, export, save, and UI tests
npm run test -- src/examples.test.ts  # All bundled examples: loading and save/reopen smoke tests
npm run lint                 # TypeScript / React / security lint rules
npm run scan:sast            # Local ESLint security + DOM sink analysis
npm run scan:dependencies    # npm advisory audit, all severities
npm run build               # Strict TypeScript check and Vite production build
npm run check               # Lint + tests + build
```

The example smoke suite pins cell coordinates, CP437 bytes, and colors for
every bundled `.ans` file. It checks native-stream and download save paths,
identical cells/raster hashes after reopening, and byte-stable subsequent saves.
The LF-only example also has a reference-image raster baseline, excluding only
three glyph shapes that differ in the reference font; those cells still have
exact byte/color/position checks. Native file handles are mocked in these tests.

SAST runs locally and uploads no source code. The dependency audit contacts
the npm registry with dependency metadata. Passing checks do not prove absence
of vulnerabilities. See [SECURITY.md](./SECURITY.md) for boundaries and scanner
coverage, and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for implementation.

## Experimental Ansimation

Choose **Window > Ansimation (experimental)** to animate a snapshot of 80 columns
and 25 rows starting at the editor's current top row. There is no timeline.
Choose a canned effect, frame detail, and preview modem speed, then **Play**.
Replay starts from the beginning; changing a control stops playback. Nothing
changes the original document, undo history, modified indicator, or save handle.

Single-art effects reveal the art from blank, or erase it to blank. **Load second
ANSI** uses the selected file's first 25 rows as the layer beneath the current
snapshot, without replacing the editor document. Effects include wipe, cell
cross-dissolve, flickering flame, downward/across erasers, wandering spotlight,
Venetian blinds, iris reveal, digital rain, Neo, bullet holes, checkerboard, text spinner,
and text slide. Cross-dissolve
switches whole cells rather than blending colors outside the DOS palette.

**Neo** rains flickering ASCII letters/digits in light and dark green in sparse
trails: one rain column per four-column group, at most 20 across the screen.
It reveals the art beneath and works with one or two ANSIs.
**Bullet holes** removes differently sized, aspect-correct circles one at a time.
Blocks fly outward, shrink, and disappear before the next hole is cut. Earlier
holes stay open and overlap until the full screen is revealed. With one ANSI
the holes expose blank space; with two they expose the second art beneath.
Its 61 steps are automatic so frame detail cannot skip a burst's cleanup.
**Text spinner** and **Text slide** are single-art effects that reveal only
ASCII A-Z, a-z, and 0-9, top-to-bottom and left-to-right. Accented/Greek CP437
glyphs, punctuation, borders, and shading remain unchanged. Spinner emits
`|/-\|/-\|` three times before each letter. Sliding letters enter one at a time from column
80, cross blank spaces, and hide behind decorative glyphs, retaining each
position's background color. The final screen exactly matches the original.
Any loaded second ANSI is retained for other effects but is not used for text
effects. Text steps are generated automatically; frame detail is hidden so it
cannot skip spinner phases or sliding positions. A screen without ASCII letters
or digits is unchanged, with a visible explanation.

Preview speeds are 2.4k, 9.6k, **14.4k**, **28.8k**, **56k**, and 115.2k. Preview
consumes the actual exported bytes, including partial frame updates, approximating
serial 8N1 at ten bits per byte. Compression, latency, and real BBS behavior
can change the speed. Background tabs pause transmission. Frame detail chooses
13, 37, or 73 generated frames for general transitions, not a guaranteed
duration. Bullet holes and text effects always include their required steps; lower modem
speeds make their motion easier to see.

**Export ANSI** writes a separate binary CP437 `.ans` animation copy through the
existing browser picker/download flow. It uses classic bold bright foregrounds,
eight backgrounds, and cursor-addressed changed cells without bottom-row
newlines. **Plain ANSI has no portable frame delays**: playback depends on
the BBS/player's output speed; fast viewers may display only the final screen.
The preview speed is not embedded in the file. Use an 80x25 CP437 terminal and
test on your intended BBS. Reopening an exported animation in the editor loads
its final screen, not an editable sequence. No video export or automatic loop.
All sources/settings stay in page memory; save your art separately before closing.

## Deliberate first-version scope

No timeline/frame-by-frame animation editing,
variable width, remote service,
accounts, plugins, or autosave. Node runs tooling, the local static/dev server,
and optionally the agent broker, never a filesystem-access API. Unless agent
access is enabled the page makes no application network requests; development
mode additionally uses Vite's local HMR connection.
Sparse storage and virtual rendering remove a fixed line cap, but available
memory, undo history, disk size, export time, and safe-integer coordinate
precision remain real machine limits.

## Future agents

Read [AGENTS.md](./AGENTS.md), then load the relevant project skill:

- [ANSI editor maintenance](./.github/skills/ansi-editor-maintenance/SKILL.md)
- [Local security verification](./.github/skills/local-security-verification/SKILL.md)
