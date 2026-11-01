# Security model and verification

This is a **local-only application**, not a hardened public web service.
Clean SAST and audit results are useful evidence, not a security guarantee.

## Boundaries and controls

- Dev and preview bind to `127.0.0.1`, use strict ports, restrict accepted
  hostnames, and disable cross-origin CORS. The optional agent broker binds
  separately to 127.0.0.1:47831 and permits only exact editor origins on its
  authenticated owner route; the agent route rejects all Origin headers.
  Vite's built-in localhost/IP
  handling still applies. Do not use `--host 0.0.0.0`, expose a tunnel, or
  permit arbitrary hosts. A malicious local process is outside this boundary.
- There are no filesystem APIs on the Node servers, file uploads, arbitrary
  path parameters, shell commands, accounts, remote assets, or telemetry.
  The IBM VGA WOFF and derived bitmap are bundled locally with their license
  and attribution. Runtime rendering uses only the bitmap; no remote font
  service, runtime font parser, or system installation is involved.
- Native open/save uses only browser File System Access pickers. A user must
  grant access to a specific file. Handles are session-memory-only. Save errors
  are surfaced; no broad success-shaped fallback hides failed native writes.
  File-input opening grants read access only and never preserves a prior save
  handle for the newly opened document. File bytes stay in the browser.
- Cells accept CP437 bytes 32-255, foreground colors 0-15, and background
  colors 0-7, never raw control bytes. Bright backgrounds and blink are excluded.
  Only the exporter emits validated ANSI control sequences. Text is rendered
  through React/canvas, never as HTML. Imported files use a streaming CP437
  parser with a bounded CSI buffer and explicit safe-coordinate validation.
  Only supported non-executable ANSI color/cursor/erase commands are interpreted;
  unsupported controls, attributes, and malformed/unsupported metadata fail visibly before document
  replacement. Escape strings cannot execute scripts, navigate, or fetch URLs.
  SAUCE00 static ASCII/ANSI metadata is validated separately and excluded from
  terminal decoding. Only its 128-byte record and optional five-byte comment
  signature are read ahead; comment counts are byte-bounded, and declared file
  size/height never drive allocations. Metadata is not retained on export.
  LF-only art and explicit DEC autowrap (`?7h`/`?7l`) are supported; other
  private modes still fail. Repeated DOS EOF bytes are accepted as trailing
  padding, but any non-EOF content after EOF still fails.
- A restrictive CSP blocks third-party scripts, connections, frames/embedding,
  objects, forms, and base-URL replacement. Style attributes are allowed for
  fixed color swatches. Browser agent schemas configure Zod with `jitless: true`
  before construction, avoiding its dynamic-code-generation capability probe
  without permitting `unsafe-eval`. Node broker/MCP configuration is unchanged.
  Development additionally permits inline scripts for
  Vite React refresh and its loopback HMR WebSocket. Preview removes both
  development allowances. The production build also embeds the supported
  production CSP directives in a meta tag before scripts/styles, so static
  hosting retains these restrictions without custom headers. Anti-embedding
  remains header-only; see Static hosting below.
- Agent access is off by default. CSP additionally permits only the fixed
  loopback broker address. An owner key enables a single editor session; explicit
  human approval issues separate 256-bit agent tokens with 30-minute expiry.
  Disconnect, New, successful Open, lease expiry, and restart revoke grants. MCP is stdio only.
  See [MCP security boundaries](./docs/MCP.md) for all limits and failure semantics.
  Grants authenticate token possession, not AI identity; anyone who obtains
  the owner key or can automate the owner browser can grant access. Privileged
  local software is not isolated by this design.
- `nosniff`, no-referrer, and camera/microphone/geolocation restrictions are
  applied on both servers.
- Sparse documents and bounded viewports avoid allocations proportional to
  the largest row index. Native saves stream bounded chunks and can be canceled.
  The download fallback is limited to 64 MiB and errors rather than silently
  truncating. Huge numbers of painted cells, history patches, or giant exports
  can still exhaust resources. The app is not a defense against a hostile
  browser extension or someone with access to the local machine.
- Unsaved art is not persisted. A close/reload warning reduces accidental loss
  but browsers can bypass it. Native picker cancellation and download fallback
  are communicated distinctly from verified native close success.

Experimental Ansimation uses copied, bounded 80x25 frames and the same validated
CP437/color ranges. A second art file is read through the existing authorized
picker/parser; its handle is not retained for writes. Animation export uses a
separate authorized picker/download and the existing abortable writable lifecycle.
Only fixed cursor/color controls are generated; user cell bytes cannot emit
terminal controls. No timing scripts, player executable, new server route,
network service, persistence, or additional dependencies are introduced.
The browser preview simulates byte transmission speed, not an unrestricted
terminal. ANSI playback compatibility/timing is not a security guarantee.

## Static hosting

The browser build can be served from an HTTPS static host such as GitHub Pages,
including a project subdirectory. Deploy the entire `dist` directory, not
`build-mcp`. Hosting distributes the UI and bundled assets; artwork and file
handles remain in browser memory and no upload or persistence service is added.
Enable **Enforce HTTPS** in GitHub Pages settings. Native file-picker support
still depends on a secure context, browser capabilities, and user permission.
Opening built HTML through `file://` is not a supported deployment method.

The build injects a CSP meta tag at the start of the head, before any executable
scripts or stylesheet loads. It reuses preview's policy, omitting only
`frame-ancestors`, which browsers do not enforce from a meta tag. It permits
same-origin scripts/fonts, local styles and fixed-color style attributes,
same-origin/blob images, and same-origin connections plus the existing fixed
loopback broker address. Other script sources, inline scripts, eval, child
frames, objects, forms, and base-URL replacement are blocked. Production does
not permit development's inline refresh scripts or HMR WebSocket.
The existing `meta name="referrer"` supplies `no-referrer` without a header.
When CSP response headers are also present, both policies apply; a meta tag
cannot relax a stricter host policy.

| Protection | Static HTML | Additional hosting requirement |
| --- | --- | --- |
| Supported CSP resource/form/base restrictions | Included in production meta CSP | Keep compatible CSP headers if the host supplies them |
| Referrer suppression | Included as `no-referrer` metadata | A matching Referrer-Policy header is also recommended |
| Prevent other sites embedding this editor | Not enforceable through meta CSP | `Content-Security-Policy: frame-ancestors 'none'` response header |
| Prevent MIME-type guessing | No HTML equivalent | `X-Content-Type-Options: nosniff` response header |
| Disable camera, microphone, and geolocation by policy | No HTML equivalent | `Permissions-Policy: camera=(), microphone=(), geolocation=()` response header |

GitHub Pages does not ordinarily offer project-specific custom response headers.
Do not assume a `_headers` file or `http-equiv` tags for header-only protections
will work there. Full parity with local preview requires hosting that supports
those response headers. Meta CSP also cannot provide CSP `sandbox` or reporting
directives such as `report-uri`; this app adds neither sandboxing nor telemetry.
Meta policy only covers content parsed after it, so keep it ahead of scripts
and do not insert executable content before it.

Static hosting does not expand the agent broker's exact local Origin allowlist.
Agent access stays off by default and is not supported from GitHub Pages;
the loopback allowance in CSP is not authentication or CORS authorization.
Use the local editor for agent workflows. Dev/preview/broker servers must still
bind only to loopback; never publish the broker.

These are defense-in-depth measures, not protection against a compromised host,
same-origin script bundle, privileged extension, or local machine. Meta CSP
does not replace the missing header-only protections or make this a hardened
public web service.

## Trusted dependency policy

React and React DOM render the browser UI; Zod validates shared agent messages.
The separately licensed Web437 IBM VGA 8x16 font is pinned by SHA-256.
Its offline bitmap converter uses only Node built-ins and rejects unexpected
metrics or non-whole-pixel outlines. Display preferences remain page-memory-only.
The official `@modelcontextprotocol/sdk` runs only in the Node stdio adapter;
its transitive dependencies are included in audits. The broker uses Node's
built-in HTTP/crypto, not an additional web framework. Development packages
come from the established Vite, TypeScript, ESLint, Vitest, Testing Library,
and JSDOM ecosystems. ESLint's security and no-unsanitized plugins are local
static analyzers. Keep `package-lock.json`; use `npm ci` to reproduce versions.
Do not add CDN code, remote fonts, obscure helpers, or dependencies for trivial
operations. Review advisories, transitive additions, package provenance, and
install scripts before upgrading. No package is trusted merely because npm
audit currently has no advisory for it.

### Temporary minimatch override

`package.json` overrides minimatch 10.x with **11.0.1** to address
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
(glob preprocessing amplification / denial of service).
ESLint, `@eslint/config-array`, and `@typescript-eslint/typescript-estree`
currently request 10.x, so ordinary dependency updates cannot pick up the fix.
The override is limited to that major version rather than forcing unrelated
minimatch consumers onto a new API. Keep ESLint and TypeScript-ESLint current;
do not apply npm audit's suggested breaking downgrades.

The patched package supports the project's Node versions and CommonJS/ESM
imports. Validate lint file coverage, SAST, tests, and builds when changing it.
Remove the override once all three upstream consumers resolve to a patched
version without it. The affected packages are development tooling, not editor
runtime dependencies; audit results still cover both.

## Repeatable scans

```powershell
npm run scan:sast
npm run scan:dependencies
npm run check
```

### SAST scope

`scan:sast` executes ESLint over application code, tests, and JS/TS config
using `eslint-plugin-security` recommended rules, `eslint-plugin-no-unsanitized`
DOM sink rules, React Hooks rules, TypeScript rules, and explicit prohibitions
on eval, implied eval, and Function constructors. Warnings fail the command.
This is an ESLint-based SAST scan, not Semgrep or CodeQL.

`security/detect-object-injection` is disabled because it flags the project's
numeric CP437/color/geometry array indexing. Document storage uses Maps, not
untrusted object property assignment. Keep this exception narrow in intent;
if arbitrary string-keyed data is introduced, review that trust boundary and
prefer Maps/own-property guards rather than assuming this suppression is safe.

Limitations: these rules are largely syntactic, are not whole-program taint
analysis, and cannot prove correct browser permissions, ANSI encoding,
transaction identity, or absence of all XSS paths. They do not scan generated
bundles, dependency internals, HTML, CSS, or Markdown. Review those surfaces
when changing them and verify headers in a running browser/server.

### Dependency audit scope

`scan:dependencies` runs `npm audit --audit-level=low`, including development
dependencies. Unlike SAST, it contacts the configured npm registry with package
metadata. It does not upload application source. It detects known registry
advisories, not unpublished vulnerabilities or malicious package behavior.

## Initial verification

On 2026-10-30, with Node 26.13.0 and npm 11.20.0:

- 39 automated tests passed (model, binary export, saving, UI), including the
  exact 64 MiB download threshold and cancellation of billion-row exports.
- Strict TypeScript and Vite production build passed.
- Configured ESLint SAST completed without findings.
- npm advisory audit reported zero known vulnerabilities.
- Both running servers returned the expected security headers, rejected a
  hostile Host with HTTP 403, and omitted cross-origin CORS permission.
- Real-browser checks covered keyboard/pointer editing, undo/redo, distant-row
  navigation with a bounded canvas, preview pixels/toggling, and native Save
  versus Save As using a mocked browser picker/writable.
- The production build rendered under its stricter CSP without console/page
  errors or off-origin application requests.

These are point-in-time results. Rerun after changing code or dependencies.
Browser rendering and permissions require separate interactive checks;
unit tests mock native file handles and do not prove a real OS dialog works
on every browser. Do not interpret initial verification as an independent audit.

## MCP addition verification

On 2026-10-30, the expanded suite passed **73 tests**. Added checks cover
unauthorized access, separation of owner/agent credentials, exact Host/Origin
policies, single-editor isolation, revocation of active clients and queued
jobs, 30-minute token expiry with a continuously renewed editor lease,
15-second lease expiry, grant/concurrency/rate limits, oversized Content-Length
and chunked bodies, unknown outcomes after job timeout, strict command bounds,
atomic undoable edits, and stale-document/revision rejection.

The official SDK client also exercised a real spawned stdio adapter. A separate
end-to-end check connected the production browser with its owner key, issued an
agent token through the confirmation UI, painted and read four cells through
the actual MCP process, verified preview pixels and Undo, then revoked and
disconnected. Temporary broker/preview processes were stopped afterward, making
their credentials unusable. TypeScript/build, ESLint SAST, and npm audit passed
(zero known dependency advisories). Vite emitted upstream Zod comment-annotation
warnings; they did not prevent the build.

These are functional and local scanner checks, not an independent security
audit or a guarantee against malicious software running with the same OS-user
privileges.

## If a security issue is found

Do not include personal filesystem paths, art, or secrets in public reports.
Record the affected code, reproducible steps, trust boundary, expected/actual
behavior, severity reasoning, and a regression test. Keep the server stopped
if loopback restrictions or native-save permissions are in doubt. There is no
remote deployment or public vulnerability-reporting endpoint for this project.
