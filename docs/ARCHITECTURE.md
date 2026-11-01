# Architecture

## Runtime and trust boundaries

React renders the controls; HTML canvas renders the document and preview.
The main canvas, agent panel, and VGA preview use distinct document-scoped
React keys so New/Open remount each surface without sibling-key collisions.
All art, history, selections, and the internal clipboard live in page memory.
Node.js runs Vite and development tools, plus an optional authenticated local
agent broker. The editor works without the broker, and agent access is off by
default. See [MCP design and setup](./MCP.md) for its explicit trust boundaries.

The shared agent protocol configures Zod's non-JIT validator before constructing
schemas when running in a browser. This skips the eval capability probe under
the existing CSP. Node broker/MCP processes retain their prior Zod configuration;
the validation schemas and limits are identical in both environments.

The only persistent artwork write capability is a handle returned by a user-initiated
browser file picker, subject to browser write permission. The download fallback uses an in-memory Blob and a
temporary object URL. New documents forget the previous handle but preserve
the brush/clipboard preferences. Opening replaces the handle with the selected
file's native handle, or clears it for read-only file-input fallback.
Reloading loses all in-memory state except the five Settings menu preferences:
canvas font, cell size, character width, New/Open columns and ANSI mode.
These are stored under `ansi-workshop.settings` in origin-scoped localStorage,
with a versioned, bounded, strictly validated whitelist. Missing storage uses
defaults; malformed/unsupported storage and read/write failures are logged and
shown visibly without blocking editing. Initial loading does not rewrite storage.
Only preference changes write; invalid column drafts preserve the last valid
column preference. Reload still creates a default 80-column classic document;
saved New/Open options apply only on those commands. No art, handles, tokens,
clipboard, swatches, tools or preview visibility are stored.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/ansi.ts` | DOS-order 16-color foreground/eight-color background palettes, CP437 display table, F-key palettes, directional glyph reflection |
| `src/colors.ts` | Explicit ANSI/Tundra document formats, tagged RGB values, validated CSS colors |
| `src/tundra.ts` | Bounded streaming Tundra24 parser and sparse binary export with optional SAUCE |
| `src/TundraColors.tsx` | RGB ink pickers, named in-memory swatches and paginated current-art colors |
| `src/model.ts` | Sparse cells, coordinates, rectangular block operations, Bresenham stroke interpolation, transaction history |
| `src/draw.ts` | Local-coordinate half-row stroke interpolation and matching-ink half-block merging |
| `src/primitives.ts` | Aspect-correct rotated primitive coverage, full/half-block rasterization, color-preserving sparse subtraction |
| `src/path.ts` | Local-coordinate cubic Bezier flattening, even-odd pixel coverage and sparse block-fit fill/subtraction |
| `src/gradient.ts` | Aspect-correct linear/radial shading and ordered dithering |
| `src/fill.ts` | Shared sparse painted-region matching, shape recoloring, enclosed blank-area discovery and filling |
| `src/move.ts` | All-color connected shape discovery and sparse, edge-clamped move overlays |
| `src/export.ts` | Bounded binary ANSI/ASCII chunk generators, DOS-to-ANSI color conversion, shared sparse row ordering |
| `src/ansimation.ts` | Bounded 80x25 snapshots, deterministic CP437 transitions, delta ANSI stream and byte-rate playback |
| `src/AnsimationPanel.tsx` | Experimental modal controls, read-only second art, VGA rendering and separate animation-copy export |
| `src/import.ts` | Streaming CP437/ANSI decoder, bounded control parsing, sparse cursor coordinates, cancellation |
| `src/sauce.ts` | Bounded SAUCE00 metadata decoding, CP437 field validation, streamed trailer encoding |
| `src/SauceDialog.tsx` | Modal metadata draft, explicit Apply/Cancel/removal, read-only format hints |
| `src/open.ts` | Browser-authorized native open picker and read-only file-input fallback |
| `src/save.ts` | Native picker capability, streamed writable lifecycle, cancellation, bounded download fallback |
| `src/Canvas.tsx` | Virtual viewport, pointer capture, wheel navigation, font dispatch, live preview |
| `src/vgaFont.ts` | Deterministic CP437 pixel masks and bounded color/size glyph atlases |
| `src/assets/ibm-vga-8x16.json` | CC BY-SA 4.0 bitmap derived from the bundled Web437 source, with provenance |
| `src/assets/fonts/LICENSE.txt`, `src/assets/fonts/NOTICE.txt` | Full font license and attribution, imported as raw text for Settings and About |
| `scripts/generate-font.ts` | Offline verified WOFF-to-bitmap conversion using only Node built-ins |
| `src/App.tsx` | React session state, commands, menus, keyboard dispatch, save status, unsaved-change protection |
| `src/settings.ts` | Versioned Settings-only localStorage whitelist, validation and explicit storage errors |
| `src/agentProtocol.ts` | Shared strict Zod command/result schemas and operation limits |
| `src/agentCommands.ts` | Complete-batch validation, document/revision checks, undoable edits and bounded reads |
| `src/AgentPanel.tsx` | Owner pairing, grant/revoke controls, heartbeat/polling and acknowledgment |
| `mcp/broker.ts` | Opt-in loopback authenticated relay, owner lease, expiring grants, bounded job queue |
| `mcp/start.ts` | Owner-only broker startup/bootstrap key output |
| `mcp/stdio.ts` | Official-SDK MCP adapter exposing only read_region and draw_cells |
| `src/styles.css` | Local-only styles and responsive layout |
| `vite.config.ts` | Loopback-only servers, CSP/response headers, React and Vitest configuration |

Coordinates are zero-based internally and one-based in the UI. Each Editor has
an immutable width, default 80, validated from 1 through 512. New/Open settings
do not resize existing documents. SAUCE width overrides the import fallback.
All drawing, block operations, viewport/pointer mapping, and file codecs receive
the document width; the default-width helpers retain classic behavior.
Rows are represented as nonnegative safe integers; the UI reserves a small
arithmetic margin near Number.MAX_SAFE_INTEGER. This is a numeric precision
boundary, not an allocated document length or a practical screen-size cap.

## Sparse model and editing

Cells are a `Map<string, Cell>` keyed by `"x,y"`. A default space with foreground
7 and background 0 is absent from the map. A colored space is not necessarily
default and must remain stored. Cell records are copied on writes.
An Editor constructed from imported cells validates/copies them directly into
its clean baseline; importing does not allocate undo transactions for the file.
ANSI validation permits foreground indexes 0-15 and background indexes 0-7.
The picker and Ctrl+arrow cycling share those palette bounds. Swapping a bright
foreground into the background explicitly reduces it to its base color and
notifies the user; classic mode exports no bright backgrounds or blink.
The explicit `ice` format permits indexes 0-15 for both inks (not RGB).
Its decoder treats SGR 5 as background intensity and SGR 25/reset as clearing
intensity. In iCE mode, SGR 100-107 also selects explicit bright backgrounds;
SGR 40-47/49 replaces that selection, while SGR 5/25 independently controls
the intensity bit without adding it twice. Export emits SGR 5/25 plus base 40-47 backgrounds, never animated
blink or extended 100-107 colors. SAUCE flags select the ANSI format on import;
metadata-free files use the New/Open mode setting. Agent access and Ansimation
remain restricted to 80-column `ansi` documents; `readAnsi` retains that restriction
for animation imports while `readAnsiDocument` supports document options.

Each Editor has an immutable document format, defaulting to ANSI. TundraDraw
additionally accepts foreground/background indexes 0-15 and RGB values tagged
with `0x1000000`; low RGB values cannot collide with palette indexes.
`rgbColor` canonicalizes RGB equivalents of classic colors to their palette
index, preserving default blank omission and color equality in existing tools.
RGB validation is explicitly enabled only for Tundra editors and their
fill/gradient calls. Classic ANSI export and animation still reject RGB cells.
Paste validates all source colors before clearing any destination cells.

The Editor owns a mutable map; React holds the Editor instance and synchronously
increments a ref-backed revision counter, mirroring it into state to redraw.
This keeps agent revision checks current while React schedules a render.
Reading the map must not mutate
it (it is exposed through ReadonlyMap). Future background workers should use
snapshots or a redesigned ownership boundary, not mutate it concurrently.

`paint` records the first before-value and latest after-value in a pending
transaction. `commit` drops net-zero changes and assigns a unique state ID.
Undo/redo replays patches, preserving before/after state IDs. Saved identity
uses the captured state ID, not stack depth, so branching and editing during
async saving do not accidentally clear the modified flag. Undo history is
memory-resident and currently unbounded; sparse storage does not make an
arbitrarily large number of edits free.

SAUCE metadata is an optional, immutable Editor value. Metadata edits commit
pending drawing first and use the same transaction IDs/undo/redo stacks as
cells. Imported metadata starts in the clean baseline. Save captures metadata
alongside cells and version before awaiting the picker; later edits stay dirty.
The File > SAUCE dialog holds a separate draft until Apply, restores File
heading focus on close, and does not dispatch canvas/history shortcuts from inputs.
ANSI output appends DOS EOF, optional COMNT lines, and a SAUCE00 record only when
metadata exists. File size/width/height are regenerated from output, preserving
font/flags/additional type hints. Heights above 65,535 use zero (unspecified);
32-bit file-size overflow fails explicitly and native writing aborts.
ASCII/animation copy exports stay metadata-free. iCE and nondefault-width saves
generate a minimal SAUCE trailer when descriptive metadata is absent, so reopening
preserves mode/wrapping. Width and the ANSI iCE bit are regenerated from immutable
document options; Tundra flags retain their original meaning. Such files cannot
bypass SAUCE's 32-bit size bound by removing descriptive metadata.

Copy and clear iterate stored cells, not every selected coordinate. A Block
stores its dimensions and sparse relative cells. Paste clears the destination
rectangle first, making blank cells opaque, then writes clipped source cells.
Flips transform positions and a curated table of directional CP437 glyphs;
unrecognized symbols retain their glyph. Block operations must be committed
as one command. Large edit operations still take time proportional to the
number of stored cells; native saving takes time proportional to output size.

## Rendering and navigation

`src/tools.ts` shares the tool type and an exhaustive cursor mapping. The main
canvas receives the active tool and uses bundled 32x32 SVG mouse cursors with a
fixed (3,3) crosshair hotspot, black/white contrast strokes, and native fallbacks.
Vite emits local cursor assets; no data URLs, new CSP allowances, or network
dependencies are needed. Preview gestures and the rendered typing cursor are
unchanged.

The editor canvas has a 42-pixel row gutter and document-width cells. Settings independently
select 8x16 (default), 10x20, or 16x32 cells, and IBM VGA (default) or the former
Consolas renderer. A separate 8/9 native-pixel width setting changes scaled
cell widths and atlas cache keys. In 9px IBM masks, the original eight columns
are unchanged; column nine repeats column eight for bytes 192-223 only and
is blank otherwise. Both canvases and glyph samples use this setting.
They are session-only, survive document replacement, and do
not modify cells/history/saved identity. ResizeObserver sets the visible row
count from the available host height minus the 25-pixel column ruler.
CSS `round(down, …)` snaps the responsive host height to complete cell rows,
including the measured horizontal scrollbar height. This avoids a blank strip
below the gutter without resizing feedback or partial rows. The main canvas
focus outline is inset so the scroll host and sticky ruler cannot clip it.
A previously visible cursor remains visible when fewer rows fit.
Canvas and ruler share a horizontal scroll host; neither is CSS-shrunk to fit.
Both have a one-pixel right border marking the final column. The canvas uses content-box
sizing to preserve every art pixel; the ruler includes that extra pixel in its
width. Pointer mapping excludes the actual border widths, including asymmetric
borders.
The app shell allows up to 1720 pixels, enough for the 1322-pixel 2x canvas,
editor borders, wide-screen sidebar, gap, and workspace padding. Narrower
windows retain horizontal scrolling inside the canvas host.
The error banner and status footer share one bottom-sticky container, keeping
errors immediately above the footer without requiring page scrolling. The
container stays in document flow and follows wrapped banner/footer heights.
In 2x mode the host reserves 825 content pixels: 25 rows at 32 pixels
and the column ruler. ResizeObserver adds the
measured horizontal scrollbar height to the minimum host height when necessary,
so a narrow window's scrollbar cannot consume a row. This yields a terminal-style
80x25 view even in short windows, which scroll the page instead. Native and
1.25x modes retain viewport-responsive height.
Pointer focus does not scroll the page, keeping partially visible tall canvases
stationary during strokes. Pointer coordinates account for the gutter; capture keeps a stroke active
when the pointer leaves the canvas. Pointer up, cancel, or lost capture commits.
Intermediate cells are filled using Bresenham interpolation.
The Cursor tool and Alt+click on the main canvas focus and reposition the cursor,
clearing selection without entering a pointer stroke, editing cells, or committing
history. They do not capture the pointer; subsequent movement cannot paint or
select. Alt+click preserves the active tool. Keyboard editing remains available
in Cursor mode.
Selection drags clamp the endpoint to the visible edge and auto-scroll vertically
every 50 ms while the captured pointer remains above/below the canvas. Distance
outside controls a bounded rate; the anchor stays fixed and both viewport and
endpoint respect safe row coordinates. Release, cancel, lost capture, Escape,
or focus loss stops scrolling. Replacing the document remounts the canvas and
cleans up any drag timer. Draw/erase/recolor strokes do not auto-scroll.

Draw defaults to Full Block, preserving selected-character cell painting.
Half Block maps each pointer to a cell plus its upper/lower half,
using the same viewport/border/scale mapping as ordinary navigation. Interpolation
uses square one-column-by-half-row pixels with Bresenham and local doubled row
offsets, never doubled absolute row coordinates. Unsafe coordinates fail explicitly.
There is no slope threshold, alternating pattern, or left/right half-block output.
The sparse segment map merges opposite halves with matching FG/BG into byte 219
and retains matching full blocks on retracing; otherwise it writes byte 223/220
with the current FG/BG, replacing incompatible glyphs/colors. Each segment is
validated before model writes and shares the normal stroke transaction, live
preview revision, and commit-on-cancel lifecycle. Pointer release includes the
final subcell position. Alt-click/preview navigation, typing, F-keys, and other
tools are unchanged. Draw mode is session-only and survives New/Open.

Recolor uses the same captured, Bresenham-interpolated stroke and transaction
lifecycle as Draw/Erase, including commit on pointer cancellation or lost capture.
Each visited nondefault cell retains its CP437 byte and receives the current
brush FG/BG through `editor.paint`; default cells are skipped, including blank
gaps between stored cells. Colored spaces remain eligible. Rendering and preview
updates use the ordinary document revision; no region discovery, dense storage,
or separate preview map is needed. Net-zero strokes preserve history and saved
identity. Alt+click and VGA preview gestures remain navigation-only.

The Primitive tool captures shape/style/Draw-or-Subtract mode/colors at pointer down. App holds a
separate sparse preview map, overlaid by both renderers without touching Editor,
its revision, saved identity, or undo/redo stacks. Rectangle, ellipse, rounded
rectangle, and five-point star support filled and inward one-column-thick
outlines. Rasterization uses local coordinates near the drag origin (including
at billion-row offsets), inverse rotation in 1:2 VGA proportions, and square
subcell signed-distance samples. Candidate full/upper/lower/left/right blocks
and transparent cells are scored by distance-weighted coverage error, so
ambiguous corner slivers do not force sideways teeth into otherwise smooth
curves. Thin outlines prefer a visible block over transparency on exact ties;
one-cell gestures always retain a visible mark. Only selected block cells are
included; the shape's bounding box and outline interior are never cleared. A connectivity pass
promotes half blocks only where needed to prevent gaps between neighboring
edge cells. The rasterizer and the Consolas renderer share the same logical block geometry.
IBM preserves its original 7/9-scanline upper/lower glyphs, so the displayed
edges of logical half-cell shapes differ slightly in that font.
Rotated bounds clip horizontally and above row zero; exceeding safe row
precision reports an error and discards the preview before any model writes.

Alt+horizontal movement during a primitive gesture freezes its size and changes
its angle by one degree per CSS pixel. Releasing Alt resumes endpoint sizing.
Alt+click remains cursor-only. Release includes the final pointer position and
paints the complete preview in one model transaction. Escape, pointer cancel,
lost capture, and focus loss discard it instead; ordinary strokes retain their
existing commit-on-cancel behavior. Keyboard commands and wheel scrolling pause
during primitive placement. Agent commands reject an in-progress primitive
gesture just as they reject a brush stroke. Document replacement clears the
preview and remounts the pointer handlers.

Subtract mode previews the same positive mask in the captured FG/BG, but release
passes it through `subtractPrimitive` before committing a single transaction.
Only intersecting stored cells produce edits; absent cells are never painted.
Full-block mask cells become `EMPTY`. A half-block mask is reflected along its
own axis to obtain its complementary surviving half. Two quadrant samples of
that half resolve the original full/half block's visible colors, not the preview
ink. Uniform surviving halves use that color as FG with default BG, including
promotion of an original background color into foreground. Spaces/byte 255
and equal-FG/BG glyphs are uniform-color cases. Black remnants normalize to
default blanks. Distinct-color quarters and partially cut text/shading cannot
be represented exactly in CP437 and are deliberately cleared entirely, never
expanded into the removed area or recolored with the brush. All mask geometry
is validated before model writes; malformed/unsafe geometry fails visibly.
Cancellation preserves art/redo, and a net-zero subtraction adds no history.

The Path tool holds a separate local-coordinate Bezier draft in App, with a
safe-integer origin row and fractional node/incoming/outgoing points. Closing
adds the closing cubic segment but leaves nodes and independent handles editable.
Click-drag creates mirrored handles; moving an anchor translates both handles.
Selected nodes are highlighted and available through a node selector. Deletion
preserves closure with at least three remaining anchors; fewer anchors reopen
the draft, and deleting the last clears it. Corner conversion collapses both
handles. Curve conversion creates neighbor-oriented mirrored handles without
moving the anchor; subsequent handle drags remain independent.
Canceled pointer gestures restore the pre-gesture draft; Escape/tool switching
discards it. Drafts warn on reload/New/Open, but are not document cells or exports.
Finish validates the entire result and applies one Editor transaction.
Agent commands, history and block writes pause while a draft exists.

`path.ts` adaptively subdivides cubics in 1:2 VGA proportions with a 1/32-column
flatness tolerance. Curve subdivision has an explicit complexity error rather
than silently accepting an inaccurate result. Scanline crossings use even-odd
coverage at 8x16 pixel centers; only one row of coverage is allocated at a time.
Fill chooses blank/full/four half-block candidates by pixel mismatch and skips
blank fits. Coordinates remain local during sampling, preserving half-row
precision even near MAX_ROW. No document-height raster/DOM/storage is allocated.
Safe signed handle coordinates may extend above row zero; rasterization clips
those curves at the top edge. Exceeding safe upper-row precision errors explicitly.

Subtract visits stored cells only, evaluates the original logical block geometry
or bundled VGA glyph bitmap, and replaces covered samples with the current BG.
Candidate blocks use surviving original FG/BG as foreground and the hole BG as
background. This deliberately approximates clipped text/shading and multi-color
remnants, unlike Primitive's conservative clearing. Empty/default edits normalize
through Editor; no-op subtraction adds no history. Preview is derived from
draft/current inks/document revision and shows the final edits on both canvases.
Only the main canvas overlays editable cubic outlines and nodes/handles.

The Gradient tool snapshots the four-connected stored cells matching the
starting cell's colors and glyph family: full/half blocks and bytes 176-178
form one shape family, while other glyphs require an exact byte match.
Starting on a missing/default cell instead snapshots the enclosed blank region
through Fill's shared enclosure traversal; open areas fail before any preview
or model writes. Shape discovery scales with the connected stored region;
blank discovery scales with stored art plus the connected available area, never
its bounding rectangle or row index. Linear projection and radial distance use local coordinates in 1:2 VGA
proportions. Coverage clamps at the endpoints and a 4x4 Bayer threshold
staggers adjacent 0/25/50/75/100% levels. Intermediate levels use bytes
176-178 with the captured FG/BG; both endpoints use byte 219 with the endpoint
color in foreground. The BG endpoint never requires swapping a bright color
into background. Half blocks keep their original byte and background to
preserve the outside of the shape. Their solid foreground uses the nearer
gradient endpoint (FG for t < 0.5, BG otherwise), since CP437 cannot represent
a shaded half block. Enclosed targets' default cells receive the same shading. For enclosed
half-block backgrounds, the shared `filledBlank` encoder applies the nearer
endpoint to the blank half and preserves the outline ink, merging equal colors
or reversing glyph/inks when necessary. Unrepresentable classic bright-ink
combinations fail without model writes. A separate preview map and line guide
appear on both canvases without model writes. Release includes the final
pointer position and commits one transaction; zero-length and canceled
gestures leave history unchanged. Cancellation, keyboard/wheel suppression,
agent exclusion, and document replacement follow the primitive lifecycle.

Fill and Gradient share `paintedRegion`, `enclosedBlankRegion`, and `filledBlank`
from `fill.ts`. `gradientRegion` selects discovery from the starting cell, while
the drag captures whether the target is enclosed for rasterization.
Shape recoloring sets FG without changing BG or the glyph,
except that shading bytes 176-178 become full blocks. The selected brush and
BG are not used. Enclosed mode starts on a missing/default cell and traverses
default cells plus black background halves of the four half-block glyphs.
Each available area is a local unit-cell rectangle; neighboring areas connect
only across a shared edge of positive length, never a corner. Colored spaces,
nonblack backgrounds, and other glyphs remain whole-cell barriers.
Available areas touching the top or either side edge, or entering a row with
no stored cells, are unenclosed and fail visibly. Thus an
escape into a billion-row blank gap is rejected without scanning the gap.
Coordinates are never doubled, preserving maximum-safe-row precision.
Enclosure/coordinate validation finishes before writing the model.
Default cells become full blocks with default BG. Reached half-block backgrounds
receive the fill ink without changing the outline color, merging equal inks
into full blocks or reversing glyph/inks to keep classic backgrounds valid.
Two different bright inks cannot coexist in a classic half block and fail
explicitly before any model writes; iCE/RGB use their existing palette bounds.
The entire fill commits in one transaction. Discovery stays proportional to
stored art plus the connected area, never a document-height array.

Fill and Eyedropper use single-click pointer dispatch without capture; movement,
release, and cancellation cannot repeat the action. Both focus/position the
canvas and clear selection. Eyedropper reads `editor.cell`, including the
default cell, and changes only the FG/BG brush state, not the glyph, document,
revision, saved identity, or history. Alt+click remains cursor-only. Preview
gestures retain their existing selection/navigation semantics.

Move reuses `paintedRegion` with color/glyph matching disabled to snapshot
four-connected stored art, including colored spaces. Discovery never traverses
missing cells. `moveShape` validates safe offsets/region coordinates, clamps
the translation to keep the entire shape within columns 0-79 and rows
0-MAX_ROW, and returns a sparse overlay: source cells are `EMPTY`, then
translated cells overwrite them. Clearing sources before writing destinations
handles self-overlap; holes never clear unrelated art. Both renderers use
this overlay without model writes. Release paints it in one transaction,
restoring overwritten art on Undo. Net-zero gestures preserve saved identity
and redo. Final-release coordinates, cancellation, keyboard/wheel suppression,
agent exclusion, and document replacement use the primitive/gradient lifecycle.
Preview gestures remain navigation/selection only. Memory/work scale with
connected cells, never the shape's bounding rectangle or its absolute row.

Navigation uses a row offset rather than an enormous native scroll element.
The bounded vertical scrollbar sits outside the horizontal scroll host, so
it stays reachable at every cell size and window width. Its maximum top row
is three visible pages beyond the greater of the last painted row and viewport
top, clamped at MAX_ROW. The sparse last-row scan is cached per editor revision.
Thumb size/position map this range onto the viewport-height track, with a
28-pixel minimum grab target. Pointer capture freezes the range during a drag;
release, cancellation, lost capture, Escape, or focus loss ends it. Track clicks
page and focused arrow/Page/Home/End keys navigate without editing. Live shape
placement disables it like wheel scrolling.
Wheel/page/scrollbar controls move the viewport without forcing cursor movement.
Arrow navigation brings the cursor into view. Go to row changes both.
This avoids native canvas-size and DOM-scroll-height limits.
Each surface caches just its viewport art and selection in a detached
canvas. Cursor-only movement composites that raster without rereading cells or
redrawing glyphs; document revisions, viewport/size changes, selections, and
tool previews invalidate it. Selection identity stays stable until its endpoints
change. These caches never grow with document height.

Ctrl+Left/Right changes foreground and Ctrl+Up/Down changes background, wrapping
backward/forward within each palette. These canvas-only commands do not move
the cursor, select cells, edit existing art, or enter undo history.
Blocks & shading maps F1-F10 to CP437 176, 177, 178, 219, 223, 220, 221, 222,
254, 250; F11/F12 are unassigned and do not advance the cursor.

Undo/redo shortcuts bubble to the app shell so Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z,
and Ctrl/Cmd+Y work from either canvas, toolbar buttons, and menu headings.
Canvas dispatch does not also execute history commands. Text inputs, textareas,
selects, editable content, dialogs, composing/Alt-modified events, and previously
handled events are excluded. Active move/gradient/primitive previews still block
history shortcuts without committing the preview.

The application menu headings use controlled native details/summary elements
with a single open-menu state. Opening one closes the previous menu. Choosing
another heading by hover switches menus only while a menu is already open.
Idle hover never opens a menu. Choosing
an enabled command or pressing Escape closes it and restores heading focus.
Outside pointer/focus events also dismiss it; event listeners are removed on
unmount.

The toolbar keeps drawing tools, history, and row navigation separate from
an always-present tool-options row. Tool-specific controls and hints occupy that
row without changing the canvas position when switching tools. Open/Save/Save As
are File-menu actions with canvas shortcuts, not duplicate toolbar buttons.
Pending Open/Save operations retain visible toolbar cancellation controls.

The preview renders document-width by 60 cells with 8x16 or 9x16 backing pixels and CSS thumbnail
scaling, sharing the top-row offset, cursor, and selection.
Its bounded scrollbar reuses the main canvas control with 60-row pages and
an independently cached sparse extent. Both bars update the same top-row state.
The shared non-passive wheel hook scrolls three rows (or one surface-sized page
for page-mode events), preserving Ctrl/Shift wheel behavior. Preview wheel input
requires focus within its viewport; both wheel input and its scrollbar are
disabled during live shape placement.
Both canvases share a pointer/capture/auto-scroll hook. Pointer coordinates
map through each canvas's displayed content bounds, excluding its border.
Preview clicks move without painting and drags select with any active tool;
neither changes cell data or history. During a preview gesture, only explicit
edge auto-scroll changes the viewport, preventing cursor-follow feedback under
the pointer. At gesture completion the main viewport reveals the endpoint.
Both surfaces share keyboard dispatch and selection/block commands. Document
replacement remounts both canvases; hiding the preview also cleans up its drag.
All art/character samples dispatch through `drawGlyph` with the selected font.
IBM uses a checked-in 224-glyph, 8x16 row-mask asset mapped through the existing
CP437 Unicode table during offline conversion. The source Web437 IBM VGA 8x16
WOFF is unmodified and included with VileR attribution, the original full
CC BY-SA 4.0 license, and a notice identifying the bitmap conversion.
`npm run font:generate` verifies the source SHA-256, fixed native metrics, and
whole-pixel rectangular outlines, then evaluates pixel-center winding numbers.
It requires no third-party font parser, browser font loading, network, or
system installation. Font assets retain CC BY-SA independently of application code.
Settings and Help share a native modal dialog. Settings shows the complete
font notice and license imported as build-time raw text from the bundled font
assets. Help's About view also includes the full MIT editor license, fixed
project/hosted-site links, and the major/minor version from `package.json`.
Native modal
behavior confines focus; an explicit Escape handler also supports embedded
browsers whose native dismissal is unavailable. Closing restores the originating
Settings or Help heading's focus. A bounded, keyboard-scrollable content pane
contains the long texts. Opening either view leaves the document and history unchanged.
No runtime fetch or root-relative text-file navigation is needed.
Vite uses a relative base for self-contained static browser output, including
project-subdirectory hosting. A build-only Vite HTML transform prepends a meta
CSP using preview's production policy without the unsupported `frame-ancestors`
directive. It precedes scripts/styles and leaves development refresh/HMR
unchanged. The existing no-referrer meta tag applies on static hosts too.
Anti-embedding, nosniff, and Permissions Policy remain response-header-only
hosting responsibilities; see [static hosting limitations](../SECURITY.md#static-hosting).
The separate Node MCP build is not part of the static editor runtime, and
static hosting does not expand the broker's allowed local editor origins.

IBM glyphs are expanded into RGBA atlases in JavaScript using a fixed
pixel-center nearest-neighbor rule, then drawn at 1:1 with smoothing disabled.
No browser text rasterizer or browser-dependent fractional image enlargement
is involved. The cache holds at most 64 color/size atlases and never grows
with document height. 8x16 and 16x32 give native/exact 2x glyph pixels;
10x20 is deterministic but uneven 1.25x enlargement. The original upper/lower
blocks cover 7/9 scanlines, while block editing retains logical half-cell
semantics. Consolas retains geometric blocks/shading/basic lines and system-font
text, with Courier New/monospace fallback. Its shading uses cached raster-anchored
4x2 repeating patterns with one fill per cell, not one per lit pixel.

The pixel guarantee covers IBM art in canvas backing images, excluding UI
overlays/system-font gutter labels. CSS `image-rendering: pixelated` discourages
interpolation when composited, but arbitrary zoom, display scaling, and thumbnail
reduction cannot be guaranteed physically pixel-exact. Font/size changes
invalidate the art raster cache without changing the document.

## Export and save lifecycle

TundraDraw uses the same snapshot, native writable, cancellation, download cap,
and saved-version lifecycle. Its exporter sorts only stored cells and emits
position records for gaps, with bounded chunks no larger than 4,115 bytes.
The nine-byte header is version 24 followed by `TUNDRA24`. Command 1 carries
big-endian unsigned 32-bit row then column; commands 2/4/6 carry a glyph then
foreground/background/both colors as four-byte fields (unused high byte, R, G, B).
Export writes the unused byte as zero; import ignores its value. Other supported
glyphs advance with automatic document-width wrapping. Format-unrepresentable rows
fail explicitly, without imposing a document line cap. SAUCE uses Character
file type 8 for TundraDraw instead of type 1 for ANSI.
SAUCE flag bytes are preserved for TundraDraw, including bit 0; RGB fields
already specify each ink, so the legacy ANSI iCE flag does not affect rendering.
SAUCE read/edit/export validation is format-aware, keeping classic ANSI palette
limits while detecting explicit iCE documents.
Both renderers resolve tagged colors through `colorCss`; IBM glyph atlases
and Consolas shading caches each retain at most 64 colors.

RGB pickers and named swatches are available only in TundraDraw mode.
Saved swatches hold at most 64 colors/names in document-scoped component state;
they do not modify art/history or persist in files. User Defined and Currently
Used tabs show only one compact eight-column grid at a time. Hover/focus/click
reveals an absolutely positioned name/FG/BG action group (plus Remove for saved
colors), not extra document-flow rows. Tabs use roving keyboard focus and
arrow/Home/End navigation; Escape dismisses the focused swatch actions.
Current-art colors are deduplicated from sparse cells and paginated 64 at a time. New/Open remount
the panel. Ctrl+arrows cycle the classic presets, with 16 backgrounds in RGB
mode. Crossing document formats resets brush inks. AgentPanel is unmounted
and Ansimation is disabled in Tundra mode; neither protocol is widened.

1. Commit pending edits and snapshot cells plus the model's unique version.
2. Obtain or reuse the user's browser-authorized save handle.
3. Group sparse cells by row, sort rows, and generate bounded byte chunks.
4. Emit reset/clear/home, CRLF gaps, row bytes with color changes, per-row reset,
   and a final reset. No text encoder is involved.
5. Stream chunks into a browser writable, periodically yielding to the event
   loop so cancellation and editing remain available.
6. Close on success; abort on failure/cancellation. Report errors to the UI.
7. Mark only the snapshot's version saved after a successful native close.
   A download request cannot prove disk delivery and stays modified.

File > Save As ASCII saves a separate `.asc` copy with CP437 character bytes
and CRLFs, but no reset/clear/home, SGR colors, or other ANSI escape codes.
Both generators share sparse row ordering, gap streaming, and stored-space
handling; empty ASCII output is a zero-byte file. Both formats use the same
writable lifecycle and 64 MiB download cap. ASCII copy saving always chooses
a separate destination and never replaces the ANSI handle/name or marks the
model version saved, since it discards colors. Editing during either operation
does not change the captured snapshot.

Open and Save share a native-file-access capability guard. Electron hosts,
including VS Code's integrated browser, can expose picker functions while
rejecting the resulting handles' read/write operations. They use file-input
opening and download saving instead; standalone browsers still use available
native pickers. Native errors/cancellation are not silently retried as downloads.

Streamed output has no configured row/file-size limit. The Blob download path
is capped at 64 MiB because it must accumulate the file in memory. Empty default
trailing rows are not part of the sparse document and are not exported. Row
gaps use CRLF, not cursor-down commands that clamp within a terminal viewport.
An extremely distant row can legitimately produce a very large file; Cancel
save is important. ANSI viewers may scroll the final newline at the bottom of
their viewport; the preview intentionally does not emulate those quirks.

## Experimental Ansimation

Window > Ansimation captures exactly 2000 validated cells from the current top
row, using bounded map lookups instead of scanning/allocating document height.
The second ANSI goes through the existing local picker/streaming parser, then
only its first 25 rows are retained. No handles from loading are retained by the
panel. Source snapshots are copied; model transactions, saved identity and the
main save destination are never changed.

`ansimation.ts` generates deterministic 80x25 frames. Single-art reveals start
blank; flame/erasers/bullet holes start with art and end blank. General two-art effects start
with the current snapshot and end with the second. Overlay glyphs/colors stay
in the validated CP437/DOS ranges; dissolve uses cell selection, not RGB blending.
Only bounded presentation frames are dense; documents/blocks/history stay sparse.

Bullet holes uses fifteen deterministic, varied-radius circles arranged over
the bounded screen. Vertical distances use the same 2:1 cell aspect correction
as iris reveal. Radii cover each tile's corners while leaving other impact
centers untouched, so each impact removes fresh art and their union covers the
whole frame. The sequence starts centrally, then uses a stable shuffled order.
Each impact has four mandatory steps: cut/initial blocks, outward blocks,
farther smaller fragments, then no debris before the next cut. Eight fragments
sample source foregrounds and retain the backgrounds beneath their positions;
off-screen fragments are clipped. Earlier cuts remain open. The 61 frames
(initial screen plus fifteen four-step bursts) are automatic; the panel hides
frame detail for this effect while retaining second-art loading and modem speed.
Preview/export use the same deterministic frames, without a final hard cut to
hide leftover source art.

Neo uses deterministic ASCII letters/digits and green foreground indexes 2/10
in staggered falling trails, with one deterministic rain column per four-column
group (at most 20 columns). Other columns still reveal the art beneath.
Text spinner/slide are single-art-only and identify
only ASCII byte ranges 48-57, 65-90, and 97-122. Their initial screen replaces
these glyphs with spaces while preserving colors and all other glyphs. Letters
complete sequentially in row-major order. Spinner repeats all nine bytes of
`|/-\|/-\|` three times (27 steps), followed by the original letter.
Slide advances one column per step,
from column 80 to the letter's destination; moving letters may occupy blank
spaces or hidden text cells, but decorative glyphs occlude them. Backgrounds
come from the occupied position; completed letters keep their original colors.

Text frame counts are derived from the bounded source, not the generic
13/37/73-detail selector. A fully populated 80x25 screen needs 56,001 spinner
frames or 81,001 slide frames including the initial screen. These are not stored:
the text generator streams one/two-cell changes with a single bounded settled
screen. Random-access `animationFrame` computes the same state from cumulative
per-letter step counts, without replaying prior steps. Empty-text art emits only
its unchanged screen and the panel explains why. Loaded second art is retained
but excluded from text preview/export; switching back restores it.

`animationChunks` emits reset/clear/home, changed-cell runs with absolute cursor
positions and classic SGR reset/bold foreground colors, then reset and cursor
position 25,1. It does not write newlines, a trailing printable byte after column
80, arbitrary controls from art, or timing commands. General frame diffs and
sparse text steps share the same cursor/color encoder. The fixed 80x25 viewport
is an experimental output format, not a document line limit. Each chunk is
bounded by a single frame; generation retains only adjacent frames.

`AnsiPlayback` uses the same byte generator and streaming `AnsiDecoder`. Its
read-only `screen` getter exposes partial results without calling `finish` in
the middle of a split escape sequence. Serial 8N1 is approximated as ten bits
per byte with fractional byte credit; React's RAF loop paints the partially
decoded screen and pauses hidden tabs. Options stop/restart playback; no loops
or timeline. General frame detail selects 13/37/73 steps; bullet holes and text
effects include every mandatory step. Modem speed determines
the preview's actual transmission time. Export embeds neither speed nor portable
frame delays. Real terminals/BBS throttling, modem compression and buffering may
look different; fast viewers show only the final screen.

The modal aborts reads/writes on close/unmount, cancels scheduled rendering,
contains keyboard shortcuts, and restores focus to Window. Errors/cancellation
are visible. Export always chooses a separate browser-authorized destination,
reusing `writeChunks`, including abort failure reporting and the download cap.
It never marks the editor saved or claims a download reached disk.

## Open lifecycle

The main picker accepts `.ans` and `.tnd`; animation's picker remains ANSI-only.
The filename extension selects the parser (case-insensitive `.tnd` for RGB).
`TundraDecoder` retains at most a ten-byte pending record, validates the
signature/version, positions, complete RGB fields and glyph range, and omits default
spaces. Zero bytes advance without painting; explicit default spaces clear
prior cells when a position is overwritten. The reader checks cancellation
between chunks and inspects bounded SAUCE metadata before parsing. Only a
validated Character/TundraDraw trailer is accepted, and its optional DOS EOF
separator is handled by the decoder at a record boundary. After EOF, only
spaces and repeated EOF markers are allowed as trailing padding; they do not
allocate cells or extend the document. Bytes valued 26 inside color records
are never mistaken for EOF, and the reader does not strip raw final bytes.
Control glyphs are rejected with their byte value and offset rather than
becoming terminal commands. A completely parsed Tundra document starts clean
with the same replacement safeguards as ANSI.

Open is available from the File menu and canvas Ctrl/Cmd+O. It is
mutually exclusive with Save/New/another Open, but editing may continue during
the asynchronous read. The revision is rechecked before replacement; a second
confirmation protects edits made after the initial discard warning.

The native open picker yields only a browser-selected handle. Fallback uses a
temporary file input, removes it on selection/cancel, and never grants native
write access. Neither path sends bytes to Node or a network endpoint.

`AnsiDecoder` consumes binary chunks with a bounded 128-character CSI parameter
buffer, never a text decoder or executable escape handler. It stores only
nondefault cells, clamps columns to the document width, validates safe row arithmetic, and
defers right-edge wrapping until the next printable byte, honoring the narrow
DEC autowrap mode `CSI ?7 h/l`. Cursor-forward gaps realize pending DOS autowrap
before moving. LF starts at column zero, adding a newline after pending autowrap;
CR first cancels pending wrap, so exported full-width CRLFs do not add blank lines.
This distinction preserves compressed and LF-only art at its intended positions.
SGR maps ANSI colors back to DOS
order. Unsupported controls/attributes, incomplete sequences, animated blink,
bright backgrounds outside explicit iCE mode, and unrecognized trailing data fail explicitly with a byte offset.
Repeated DOS EOF bytes are allowed only as trailing padding, including before
SAUCE; no other content is accepted after the first EOF.
Before streaming, `readAnsiDocument` inspects the final 128-byte SAUCE00 record and,
if comments are declared, a bounded `COMNT` block (at most 16,325 bytes). Valid static
ASCII/ANSI trailers are decoded separately without treating
metadata as terminal commands. Width must be 1-512 or unspecified; the iCE flag
selects the indexed-color format, and other file types are rejected. FileSize and height are advisory and never used
for document allocation. Metadata is retained in the Editor and exported on ANSI
save. Control bytes in metadata display as CP437 graphical symbols rather than
terminal commands. Imported legacy dates remain viewable; edits and exports
validate real YYYYMMDD dates or blank. Trailer inspection
is cancelable; malformed trailers leave the existing document unchanged.
`readAnsi` remains a cells-only wrapper for animation loading.
The document reader yields between file chunks, checks cancellation, and releases its
reader on success/error. There is no configured input file/row cap, but stored
cells consume memory.

Only a completely parsed file replaces the document. Replacement creates a
clean Editor without imported undo history, resets navigation/selection,
updates the filename/save handle, and remounts AgentPanel to revoke old grants.
Cancellation/failure leaves the document, history, handle, and approvals intact.

## Validation map

- `Canvas.test.ts`: exact shading density, seamless raster phase, complementary
  masks, and constant-cost cell fills with color-specific pattern reuse for
  the Consolas renderer.
- `vgaFont.test.ts`: source-checksum/bitmap reproduction, all printable byte
  coverage, original 7/9 blocks, exact 2x/deterministic 10x20 pixels, atlas reuse,
  binary alpha/color values, and invalid-input rejection.
- `model.test.ts`: billion-row sparsity, history identity, validation, block
  opacity/clipping/reflection, sparse huge selections, stroke interpolation.
- `primitives.test.ts`: filled/outline coverage, all four half-block edges,
  aspect-correct rotation, safe coordinate bounds, clipping, distant-row
  sparsity, single-transaction undo/redo, and exact binary CP437 export bytes.
  Ellipse size sweeps check monotone, symmetric edges, including the 58x13
  scalloping regression and adjacent drag sizes.
  Subtraction tests cover every full/half mask orientation and foreground/
  background color combinations, conservative quarter/text/shade removal,
  colored spaces, sparse rotated masks, transaction identity, geometry
  validation, and exact CP437 bytes for complementary/promoted-color halves.
- `gradient.test.ts`: color/glyph-family four-connectivity, preserved half-block
  geometry/outside backgrounds, endpoint extension/direction,
  deterministic dither coverage, VGA geometry, distant-row sparsity,
  single-step undo/redo, validation, and exact binary shade/endpoint export.
- `fill.test.ts`: shared shape matching, solid shade recoloring, half-block and
  colored-space preservation, enclosed holes, open/diagonal boundaries,
  reference-flood comparisons, billion-row gap rejection, safe-coordinate
  enclosures, net-zero redo preservation, and exact binary foreground fills.
- `move.test.ts`: multicolor/glyph four-connectivity, colored spaces, transparent
  holes, source/destination overlap, overwrite restoration, edge clamping,
  billion-row/safe-boundary sparsity, invalid offsets, and net-zero history.
- `export.test.ts`: exact CP437 bytes, SGR color ordering, eight-color backgrounds,
  CRLF gaps, 80th-column retention, reset boundaries, bounded distant-row chunks.
- `import.test.ts`: all-byte/color export round-trips, chunk-split controls,
  deferred wrapping, billion-row sparsity, malformed/unsupported controls,
  streamed reads, cancellation, clean imported history, bounded SAUCE/comment
  handling, unsupported SAUCE display modes, and cancellation during trailer reads.
- `open.test.ts`: native picker/handle boundaries, read-only fallback, picker
  cancellation/read failures, and temporary input cleanup.
- `examples.test.ts`: every bundled ANSI example must match pinned cell/color/
  coordinate baselines, then preserve cells and IBM VGA raster hashes through
  native-stream and download saves, reopening, and a byte-identical second save.
  The LF-only example also matches a pinned artwork raster hash from the user's
  reference image (only f, v and small-square glyphs excluded for reference-font
  differences; their coordinates, bytes and colors remain in the cell baseline).
  Raster hashing uses a single row buffer, not a document-height canvas.
- `save.test.ts`: picker contract, cancellation, writable close/abort semantics,
  explicit disk/abort failures, download object URL cleanup, exact 64 MiB
  fallback boundary, and cancellation of a billion-row streamed export.
- `App.test.tsx`: canvas keyboard/pointer commands, palettes/colors, distant
  rows, undo/redo, copy/paste, preview toggle, error messaging, New confirmation.
  Rendering regressions check cursor-only cache reuse with/without selection,
  edit/undo, scroll invalidation, and bounded distant-row rasters.
  Display-setting tests check both fonts, all three sizes, rulers, synchronized
  preview, pointer mapping, unchanged art/history, credits, and menu exclusivity.
  Cell grid controls are absent from the toolbar and Window menu.
  Also checks editing during native saves and the unverified-download state.
  Open tests cover clean replacement, native/fallback save identity,
  cancellation/failure preservation, and confirmation of concurrent edits.
  Regression tests cover classic F-key order, color-cycle wrapping/cursor
  stability, restricted backgrounds and swap behavior, and menu exclusivity/
  dismissal/focus restoration.
  Primitive regressions cover nonmutating previews, release-position commits,
  cancellation preserving redo, Alt rotation, and Alt+click navigation.
  Subtract mode additionally checks captured mode, filled/outline cuts for all
  shapes, final release/rotation geometry, cancellation preserving existing
  art and redo, original-color output, shortcut blocking, and empty-cut no-ops.
  Gradient regressions cover both modes, nonmutating previews, final release
  coordinates, cancellation/redo, keyboard/wheel suppression, and empty targets.
  Bucket/Eyedropper regressions cover both fill modes, click-only dispatch,
  whole-action undo/redo, visible failures, nonmutating color sampling, default
  blank colors, unchanged brush glyphs, and Alt+click navigation.
  Move regressions cover nonmutating previews, final release coordinates,
  overwritten art, single-step undo/redo, distant-row edge clamping, cancellation,
  blank targets, click-only no-ops, keyboard/wheel blocking, and Alt navigation.
  JSDOM mocks the canvas context; use a real browser to validate pixels/CSP.

Keep tests focused on observable behavior and exact output. Avoid dense fixture
documents merely to test large coordinates.
