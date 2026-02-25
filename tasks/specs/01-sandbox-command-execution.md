# 01 — Sandbox Command Execution

**Status:** Planned
**Priority:** P1
**Severity:** Critical
**Depends on:** None
**Origin:** H-01

---

## Problem

`src/main/tools/tools/run-command.ts` passes the raw `command` string to `/bin/bash -lc` (line 67) after user approval. There is no validation, logging, or restriction on what can be executed. After the user clicks "approve," arbitrary commands run — including `curl | bash`, `rm -rf /`, or data exfiltration via `$(...)` subshells.

`getSafeChildEnv()` strips API keys from the environment (good), but that's the only protection layer.

## What Exists

- `needsApproval: true` on the tool definition (line 12)
- `getSafeChildEnv()` in `src/main/env.ts` filters sensitive env vars
- No command blocklist, no audit log, no output size guard beyond `maxBuffer: 1MB`

## Implementation

- [ ] Add structured logging for every command execution: tool name, full command string, working directory, exit code, duration. Use the existing `createLogger('tools:runCommand')` pattern.
- [ ] Add a blocklist of high-risk patterns that require a second confirmation or are outright denied:
  - `rm -rf /` or `rm -rf ~`
  - `curl ... | bash`, `wget ... | sh`
  - `chmod 777`
  - `> /dev/sda`, `dd if=`
  - `:(){ :|:& };:` (fork bomb)
- [ ] Log the first 1KB of stdout/stderr per execution for post-hoc debugging (redact if it matches known secret patterns).
- [ ] Consider adding a `--restricted` bash flag or using a restricted shell for sandbox mode, so shell builtins like `exec`, `enable`, and PATH modification are blocked.

## Files to Touch

- `src/main/tools/tools/run-command.ts` — blocklist check, logging
- `src/main/logger.ts` — add `tools:runCommand` namespace if needed

## Tests

- Unit: blocked commands return human-readable error
- Unit: execution logging captures command, exit code, duration
- Unit: output truncation at 1KB for log persistence

## Risk if Skipped

A compromised or hallucinating LLM can exfiltrate data or destroy the filesystem after a single user approval.

## Review Notes (2026-02-25, codebase audit)

This is the single most critical security gap in the project. The app's core value
proposition is running LLM-generated shell commands — and the only protection layer
between "user clicks approve" and "arbitrary code execution" is `getSafeChildEnv()`.
There is no audit trail, no output redaction, and no restricted shell mode.

Consider prioritizing this **before Spec 35 (ship to users)**. Shipping a coding agent
without command sandboxing is a liability — even with user approval gating, a single
misclick on a destructive command has no safety net.
