# OpenWaggle Specs

North star: **Multi-agent conversation** — two LLMs collaborating on a task in real-time.

Everything else either unblocks it or strengthens it.

## Execution Order

```
Phase 1 — Fix foundations (unblocks multi-agent)
  01  Fix tool approval flow          <- multi-agent needs safe tool use for both agents
  03  Fix error messages              <- multi-agent needs clear "which agent failed" errors
  07  Merge condukt into main         <- simplifies codebase before building on top of it

Phase 2 — Build the differentiator
  00  Multi-agent conversation (MVP)  <- the product. sequential turn-taking, two models, shared tools

Phase 3 — Amplify the differentiator
  02  Orchestration executor perms    <- multi-agent + orchestration = agents that can actually write code
  06  Quality presets -> model routing <- per-agent model selection in orchestration tasks
  04  MCP support                     <- both agents get access to external tools (GitHub, Slack, etc.)
  08  Build actual skills             <- "Code Review" skill where Agent A writes, Agent B reviews

Phase 4 — Long-term moat
  05  Codebase indexing               <- both agents get semantic search, smarter collaboration

Phase 5 — Competitive differentiation
  13  Browser visual feedback loop    <- agent sees running UI, evaluates, iterates autonomously
  14  Codebase memory & indexing      <- passive knowledge graph that builds as the agent works
  15  Cross-agent review loop         <- Agent A generates, Agent B reviews, they negotiate
  17  Shareable skill marketplace     <- npm-like distribution for agent behaviors
  18  Auto-verification pipeline      <- agent verifies its own work (typecheck, lint, tests) + git undo
  19  Conversation handoff            <- seamless context transfer when conversations get long
  20  Subscription auth providers     <- one-click sign-in via ChatGPT/OpenRouter subscriptions
```

## Dependency Graph

```
01 (approval) --> 00 (multi-agent) --> 02 (orchestration perms)
03 (errors)   --> 00 (multi-agent)
07 (condukt)  --> 00 (multi-agent)     (simplifies, not hard dependency)
                  00 (multi-agent) --> 06 (quality routing)
                                   --> 04 (MCP)
                                   --> 08 (skills)
                                   --> 05 (indexing)

13 (browser feedback)    -- no hard deps, Playwright already in deps
14 (codebase memory)     -- evolves 05
15 (cross-agent review)  --> 00 (multi-agent) -- builds on coordinator
17 (skill marketplace)   --> 08 (skills) -- extends existing skill system
18 (auto-verification)   -- no hard deps
19 (conversation handoff) -- complements 14, no hard deps
20 (subscription auth)    -- no hard deps, enhances existing provider registry
```

## Files

| Spec | Title | Status |
|------|-------|--------|
| [00](./00-multi-agent-conversation.md) | Multi-Agent Conversation (North Star) | Planned |
| [01](./01-fix-tool-approval-flow.md) | Fix Tool Approval Flow | Done (TanStack native) |
| [02](./02-fix-orchestration-executor-permissions.md) | Fix Orchestration Executor Permissions | Planned |
| [03](./03-fix-error-messages.md) | Fix Error Messages | Partial (4 gaps remaining) |
| [04](./04-add-mcp-support.md) | Add MCP Support | Planned |
| [05](./05-add-codebase-indexing.md) | Add Codebase Indexing | Planned |
| [06](./06-wire-quality-presets-to-model-routing.md) | Wire Quality Presets to Model Routing | Planned |
| [07](./07-merge-condukt-into-main.md) | Merge Condukt Into Main | Planned |
| [08](./08-build-actual-skills.md) | Build Actual Skills | Planned |
| [09](./09-type-safety-audit.md) | Type Safety Audit | Done |
| [10](./10-provider-model-type-guards.md) | Provider Model Type Guards | Done |
| [11](./11-ship-to-users.md) | Ship OpenWaggle to Users | Planned |
| [13](./13-browser-visual-feedback-loop.md) | Browser-Aware Visual Feedback Loop | Planned |
| [14](./14-codebase-memory-semantic-indexing.md) | Codebase Memory & Semantic Indexing | Planned |
| [15](./15-cross-agent-review-loop.md) | Cross-Agent Review Loop | Planned |
| [17](./17-shareable-skill-marketplace.md) | Shareable Skill Marketplace | Planned |
| [18](./18-auto-verification-pipeline.md) | Auto-Verification Pipeline | Planned |
| [19](./19-conversation-handoff.md) | Conversation Handoff | Planned |
| [20](./20-subscription-auth-providers.md) | Subscription Auth for Providers | Planned |
