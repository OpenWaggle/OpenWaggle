# Windows MCP Stdio Sandbox Strategy

Status: accepted

OpenWaggle sandboxes local (stdio) MCP servers before trusting them. macOS uses `sandbox-exec` with a generated Seatbelt profile; Linux uses `bubblewrap` (`bwrap`). Both work because each platform ships a command-line sandbox *wrapper* that the MCP runtime can prepend to the server command, producing a `SandboxedStdioCommand` (`src/main/adapters/mcp/runtime/stdio-sandbox.ts`). Windows ships no equivalent built-in wrapper, so the current runtime fails closed on Windows: a trusted local stdio server is blocked unless the user explicitly approves unsandboxed execution.

This ADR records how Windows local-server sandboxing will be added without regressing the security model. It refines ADR-0013 (which mandates real sandboxing or an explicit unsandboxed grant) and does not change any other decision.

## Decision

- **Fail closed until confinement is real.** OpenWaggle must never present a Windows stdio server as sandboxed unless the launched process is genuinely confined. Shipping a `windows-*` sandbox tag that does not actually restrict filesystem/network is prohibited, because it would grant users false trust — strictly worse than the current explicit-unsandboxed path.
- **Target implementation: a bundled native AppContainer launcher.** A small native launcher executable (bundled per-arch under `app.asar.unpacked`, mirroring how macOS/Linux use `sandbox-exec`/`bwrap`) wraps the server process inside a Windows **AppContainer**: it creates/uses an AppContainer profile and capability SIDs, ACLs an isolated temporary directory for write access, grants read access only to the resolved read roots, and withholds network capability unless the server's permission grant allows it. The runtime prepends this launcher exactly like the existing wrappers and returns a `SandboxedStdioCommand` with `sandbox: 'windows-appcontainer'`.
- **Fallback: restricted token + Job Object.** Where AppContainer is unavailable or unsuitable, the launcher may instead run the server under a `CreateRestrictedToken` low-integrity token assigned to a Job Object (UI/child-process restrictions), with filesystem confinement via ACLs on the isolated temp directory and read roots. Network confinement in this mode is coarser and must be reported honestly in the permission summary.
- **WSL bridge is not the primary path.** Running the existing Linux `bwrap` path via `wsl.exe` is possible but rejected as the default: it requires WSL to be installed and the server to be WSL-runnable, and it changes filesystem/path semantics. It may be offered later as an opt-in.
- **Windows Sandbox (Hyper-V) is out of scope.** It is Pro/Enterprise-only and too heavyweight for per-server launches.

## Failure Isolation

A Windows sandbox launcher that is missing, errors, or cannot confine must **fail that server's connection and report it**, never crash the app and never silently fall back to unsandboxed execution. This is already how the runtime treats any connection failure: `loadCatalog` runs each server through `Effect.either`, so a launcher error surfaces as a per-server notice (a warning for optional servers, leaving every other server and remote MCP fully usable; a controlled, reported failure for a `required` server) rather than an unhandled defect. The launcher throwing (fail-closed) is therefore safe by construction — the app stays usable and the user sees an actionable message. Regression tests already cover both paths (optional-server notice; required-server controlled failure).

## Consequences

- The `SandboxedStdioCommand` `sandbox` union gains `'windows-appcontainer'` (and, if built, `'windows-restricted-token'`) only when the corresponding verified launcher ships. Until then the Windows branch continues to throw the explicit-unsandboxed guidance.
- The native launcher must be developed, built, and tested on Windows (Windows CI), and treated as security-critical: it is verified against a confinement test suite (write outside the temp dir denied, reads outside grants denied, network denied unless granted) before any `windows-*` tag is emitted.
- Interim behavior is unchanged and safe: Windows users run local servers only via explicit unsandboxed approval (with a clear risk explanation) or use **remote MCP servers**, which need no local sandbox and already work on every platform. The MCP doctor and trust flow surface this guidance on Windows.
- Provenance and permission summaries must state the exact confinement mode so users are never misled about the strength of a Windows sandbox.
