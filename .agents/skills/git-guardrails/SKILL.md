---
name: git-guardrails
description: Define and adapt git safety guardrails for agentic coding tools. Use when setting up command filters, hooks, or policies that prevent agents from pushing, hard-resetting, cleaning, deleting branches, or overwriting unknown work without explicit approval.
---

# Git Guardrails

Centralize git safety policy for agentic coding environments. This skill does not install hooks by default; adapt the policy to the current tool only when explicitly requested.

## Blocked Without Explicit Approval

- `git push`, including force pushes.
- `git reset --hard`.
- `git clean -f`, `git clean -fd`, or equivalent deletes.
- `git branch -D` or destructive branch deletion.
- Broad `git checkout .`, `git restore .`, or pathless restore commands.
- Unstaging, reverting, or overwriting work not created by the current agent turn.
- Rewriting history or amending commits without explicit approval.

## Setup Workflow

1. Identify the agentic coding tool and its enforcement surface.
2. Translate the blocked-command list into that tool's hook, command filter, MCP policy, shell wrapper, or runtime command interceptor.
3. Preserve user/developer escape hatches that require explicit approval.
4. Test each blocked command with a harmless dry-run or simulated command payload.
5. Document the installed mechanism and how to update it.

## Tool-Agnostic Fallback

When a tool has no hook/filter support, keep the policy in `AGENTS.md` and `.agents/standards.md`, and rely on review plus repository checks. Do not invent fragile shell wrappers without maintainer approval.

## Future OpenWaggle Runtime

OpenWaggle can implement this contract as command filtering for its own shell/tool execution. Keep the policy vendor-neutral so future OpenWaggle, Codex, or other agents can share the same guardrail semantics.
