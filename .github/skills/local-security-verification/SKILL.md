---
name: local-security-verification
description: "Use when running ANSI Workshop SAST scans, dependency audits, reviewing local server headers or native save permissions, or adding packages and input handling."
---

# Verifying local security boundaries

1. Read [security model](../../../SECURITY.md) and
   [architecture](../../../docs/ARCHITECTURE.md). Identify what crosses a trust
   boundary: browser input, native file handle, package update, or server config.
2. Keep the app local: no filesystem route, upload service, remote font/CDN,
   telemetry, network share, or public server binding. For MCP changes, read
   [agent security boundaries](../../../docs/MCP.md). Preserve distinct owner/
   agent credentials, strict schema/batch/rate/queue bounds, revocation,
   document/revision isolation, and at-most-once delivery with explicit
   unknown-outcome errors. Do not retry writes automatically.
3. Run `npm run scan:sast`. Resolve warnings and errors instead of suppressing
   them broadly. Check the documented numeric-index rule exception if changing
   string-keyed objects. This scanner is ESLint-based, not Semgrep/CodeQL.
4. Run `npm run scan:dependencies`. This sends dependency metadata to the npm
   registry, not source. Review direct/transitive changes and install scripts.
   Do not use automatic force upgrades as a substitute for compatibility review.
5. Run `npm run check`. Validate control-byte/color/coordinate rejection,
   disk-error paths, cancellation, and saved-version identity when relevant.
6. Start dev, preview, and optional broker only on loopback. Verify HTTP CSP,
   nosniff, no-referrer, permission restrictions, and rejected untrusted
   Host/Origin access. Broker CORS is restricted to exact editor origins on
   its authenticated owner route; the agent route rejects any Origin.
   Preview must not allow inline scripts or HMR connections.
7. In a real browser, verify no off-origin runtime requests or CSP violations.
   Native-dialog mocks verify the interface, not actual OS permissions; state
   whether native directory selection was manually tested.
8. Report scan names, exact commands, outcomes, and limitations. Clean scans
   are not proof of security. Never upload source or art to a scanning service.
