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

## In This Repository

`.pi/extensions/git-guardrails.ts` enforces the hook-skip and force-push part of this policy for Pi and OpenWaggle Sessions, without a prompt; the rules and their fixtures live in `scripts/agent-guardrails/`. Add a fixture to `scripts/agent-guardrails/__tests__/agent-guardrails.unit.test.ts` for every new bypass you find. The pre-push hook refuses, for everyone, a push that drops commits from a branch outside `refs/heads/ow/`, and still runs `verify` on every push.

### Replaying your own PR branch onto main

A big PR keeps its number and review history when main moves: rebase your own `ow/*` PR branch onto `origin/main` and push it to the same branch with a lease naming the remote sha you replayed:

```bash
git push --force-with-lease=ow/<branch>:<expected-sha> [--force-if-includes] origin HEAD:ow/<branch>
```

The guardrail allows only that form, written out (no alias, `git -c` or `GIT_CONFIG_*`). Every destination must be `ow/…` or `refs/heads/ow/…`, each lease must name one of them with a hex sha, and `--force`, `-f`, `--mirror`, a `+refspec` or a lease with no sha stay blocked. Never rewrite `main` or a branch you did not create. Then re-review only what the replay changed: `git range-diff origin/main <expected-sha> HEAD`.

## Future OpenWaggle Runtime

OpenWaggle can implement this contract as command filtering for its own shell/tool execution. Keep the policy vendor-neutral so future OpenWaggle, Codex, or other agents can share the same guardrail semantics.
