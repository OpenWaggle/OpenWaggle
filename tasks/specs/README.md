# OpenHive Specs

North star: **Multi-agent conversation** — two LLMs collaborating on a task in real-time.

Everything else either unblocks it or strengthens it.

## Execution Order

```
Phase 1 — Fix foundations (unblocks multi-agent)
  01  Fix tool approval flow          ← multi-agent needs safe tool use for both agents
  03  Fix error messages              ← multi-agent needs clear "which agent failed" errors
  07  Merge condukt into main         ← simplifies codebase before building on top of it

Phase 2 — Build the differentiator
  00  Multi-agent conversation (MVP)  ← the product. sequential turn-taking, two models, shared tools

Phase 3 — Amplify the differentiator
  02  Orchestration executor perms    ← multi-agent + orchestration = agents that can actually write code
  06  Quality presets → model routing  ← per-agent model selection in orchestration tasks
  04  MCP support                     ← both agents get access to external tools (GitHub, Slack, etc.)
  08  Build actual skills             ← "Code Review" skill where Agent A writes, Agent B reviews

Phase 4 — Long-term moat
  05  Codebase indexing               ← both agents get semantic search, smarter collaboration
```

## Dependency Graph

```
01 (approval) ──→ 00 (multi-agent) ──→ 02 (orchestration perms)
03 (errors)   ──→ 00 (multi-agent)
07 (condukt)  ──→ 00 (multi-agent)     (simplifies, not hard dependency)
                  00 (multi-agent) ──→ 06 (quality routing)
                                   ──→ 04 (MCP)
                                   ──→ 08 (skills)
                                   ──→ 05 (indexing)
```

## Files

| Spec | Title | Status |
|------|-------|--------|
| [00](./00-multi-agent-conversation.md) | Multi-Agent Conversation (North Star) | Planned |
| [01](./01-fix-tool-approval-flow.md) | Fix Tool Approval Flow | Planned |
| [02](./02-fix-orchestration-executor-permissions.md) | Fix Orchestration Executor Permissions | Planned |
| [03](./03-fix-error-messages.md) | Fix Error Messages | Planned |
| [04](./04-add-mcp-support.md) | Add MCP Support | Planned |
| [05](./05-add-codebase-indexing.md) | Add Codebase Indexing | Planned |
| [06](./06-wire-quality-presets-to-model-routing.md) | Wire Quality Presets to Model Routing | Planned |
| [07](./07-merge-condukt-into-main.md) | Merge Condukt Into Main | Planned |
| [08](./08-build-actual-skills.md) | Build Actual Skills | Planned |
