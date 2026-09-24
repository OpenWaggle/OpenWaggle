# 0035. One-step MCP trust with a curated catalog

## Status

Proposed · Amends [0013](0013-adopt-first-party-mcp-integration.md)

## Context

ADR-0013 made MCP fail-closed: globally off by default, imported servers disabled and untrusted, per-server trust bound to an exact configuration hash, hand-picked permission grants (read roots, write roots, network), and hard rejection of plaintext secret-like env values. Production use (gosafe project, February 2026) showed the model defeats itself: a user with 21 configured servers had 0 usable. `npx`-based servers cannot run inside a no-network sandbox, the plaintext-key rejection dead-ends servers that need an API key, and every configuration edit re-invalidates trust and re-raises the whole grant ceremony. The observed escape hatch was approving unsandboxed execution — the most permissive option — because the secure path could not work. Competing agents (Claude's command-line client, Cursor, VS Code) connect servers with at most one approval and no grant ceremony.

## Decision

1. **Trust tiers.** A curated first-party catalog (Playwright MCP, Chrome DevTools MCP; more may follow) installs with zero approval steps. Every other server requires exactly one trust action — enabling it — which simultaneously applies its derived grants. Separate per-field permission editing is gone.
2. **Derived grants.** Grants are computed from the server definition instead of hand-picked: package-runner commands (`npx`, `pnpm`, `uvx`, `bunx`, `yarn dlx`) and remote endpoints derive outbound network, package-cache access (the package manager writes its download cache on first run), and temp write; a plain local command keeps the minimal profile unless its definition declares more. The OS-level sandbox stays; its grants become correct for the common server shapes.
3. **Trust invalidation becomes a notice, not a gate.** A configuration change surfaces "changed, will reconnect"; re-approval is required only when a non-catalog server is enabled for the first time, not on every edit.
4. **Install implies activation.** Installing a catalog server while MCP is globally off flips the master switch as part of the install, with a visible confirmation. Scope switches become opt-out controls rather than setup steps.
5. **Plaintext secret-like env values are permitted.** Vault references become an opt-in upgrade surfaced as a notice, never a prerequisite to connect. OpenWaggle still never writes secret-reference syntax into the shared `.mcp.json` (tool-compatibility rule from 0013, unchanged).
6. **Marketplace deferred.** v1 ships only the hardcoded catalog. The existing registry client (search, MCPB, OCI) is the substrate for a future marketplace and is untouched.

Legacy-config import stays detect → offer → one click: the scan remains read-only, applying imports enables and trusts in the same action, and nothing is ever auto-imported silently.

## Consequences

The blanket "treat all server content as untrusted until reviewed" posture of 0013 is deliberately weakened: catalog servers connect with no approval and every other server needs one click, matching industry practice, in exchange for MCP that works on the first try. Existing user state self-heals: because requested grants are now derived, enabled servers whose stored grants no longer match surface the one-click re-trust notice instead of silently staying blocked. The unsandboxed escape hatch remains only for environments where the sandbox itself is unavailable (no bwrap on Linux, Windows per ADR-0014).
