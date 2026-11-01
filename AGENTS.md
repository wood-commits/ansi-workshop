# Project instructions

## Start here

Read README.md, docs/ARCHITECTURE.md, and SECURITY.md before changing behavior.
This is a local-only CP437 ANSI editor, defaulting to 80 columns with validated
1-512-column New/Open options (never in-place resizing). Experimental canned
transitions use bounded 80x25 frames; timelines and frame-by-frame editing
remain out of scope.

## Invariants

- Keep document storage, block operations, and history sparse. Do not allocate
  a width-by-height document, huge canvas, or document-height DOM element.
- No configured line limit. Preserve safe-integer coordinate validation and
  explicit errors for operations outside representable coordinates.
- Only byte values 32-255, foreground indexes 0-15, and background indexes 0-7
  are valid classic ANSI cell values. Explicit TundraDraw documents additionally
  allow validated tagged 24-bit RGB inks and all 16 presets for both colors.
  Explicit iCE documents allow all 16 indexed backgrounds, interpreting SGR 5
  as steady background intensity and SGR 25/reset as clearing it. Classic ANSI
  remains eight-background; no animated blink or extended bright backgrounds.
  Keep animation and agent palette/width limits unchanged; expose those
  workflows only for 80-column classic ANSI documents.
  Never let user-controlled characters introduce terminal control sequences.
- Use model transactions: one pointer stroke/block action is one undo step.
  Keep saved document identity correct across undo, redo, and async saving.
- Export binary CP437, not UTF-8. Stream blank gaps and reset colors before
  line feeds. Test byte arrays, not only visible Unicode output.
  Preserve document width/iCE mode in SAUCE on save, including minimal trailers
  without descriptive metadata; validate SAUCE width before decoding.
  Optional 9px VGA rendering repeats pixel eight only for CP437 192-223;
  all other ninth columns remain blank. Keep 8px as the default.
- Only browser-authorized file handles may write native files. Do not add a
  Node filesystem endpoint, arbitrary path parameter, upload, telemetry, CDN,
  external font, or network dependency without an explicit design decision.
- Keep loopback binding, host restrictions, disabled cross-origin CORS on
  dev/preview, CSP, and the other response headers. The optional agent broker
  is the sole narrow CORS exception: exact editor origins on its owner route.
- Only Settings menu preferences persist in localStorage; artwork, other session
  state, file handles and credentials must remain memory-only. Never claim a download
  has been successfully written to disk.
- Native save and fallback have different capabilities; preserve explicit
  capability messaging and visible error/cancellation paths.
- Blocks & shading follows the classic F1-F10 order: 176, 177, 178, 219, 223,
  220, 221, 222, 254, 250; F11/F12 are unassigned. Ctrl+arrows cycle brush colors
  only while the canvas is focused. Application menus are mutually exclusive.

## Workflow

Reuse the existing types and modules. Keep dependencies minimal and trusted;
React/React DOM render the UI, Zod validates shared agent messages, and the
official MCP SDK runs only in the Node stdio adapter. Commit the lockfile
with dependency changes. Do not include generated dist or node_modules files.

Use the skills in .github/skills for changes to editor behavior or security.
Update directly related docs and regression tests with behavior changes.
Run npm run check, npm run scan:sast, and npm run scan:dependencies. For UI
changes, also verify in a browser using both drawing and keyboard workflows.
Record exact results and limitations rather than claiming the app is secure
because a scanner was clean.

## Agent access

Read docs/MCP.md before changing agent behavior. Access must remain opt-in with
separate owner and individually revocable, expiring agent bearer credentials.
Do not treat an agent label or MCP client identity as authentication. Never
write tokens to source, URLs, localStorage, or logs (only the owner's local
startup terminal prints its bootstrap key).

MCP is stdio only; the fixed loopback broker is not a general MCP HTTP endpoint.
It exposes no filesystem/shell/save tools. Keep strict schema/body/batch/rate/
queue limits, exact Host/Origin checks, document isolation, owner heartbeat
expiry, and optimistic revision validation. Check full batches before painting,
commit one undo transaction per draw, and never retry writes automatically
after an unknown outcome. New must remount/disconnect the owner panel.
