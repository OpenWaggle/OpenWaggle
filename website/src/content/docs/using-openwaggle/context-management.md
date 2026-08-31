---
title: "Context Management"
description: "Context usage, automatic Codex-like compaction, and manual /compact support."
order: 5
section: "Using OpenWaggle"
---

Every selected model has a context window. OpenWaggle reads context usage from Pi rather than maintaining a separate token estimator.

Pi's compaction internals are documented in [Compaction & Branch Summarization](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md).

## Context Meter

The composer shows an SVG context meter:

- The number inside the ring is the current usage percentage.
- The text beside it is `/ contextWindow`.
- The meter is informational.

## Manual Compaction

Manual compaction is done through the composer command:

```text
/compact
```

You can add instructions after the command:

```text
/compact preserve the schema decisions and the current migration constraints
```

OpenWaggle calls Pi `session.compact(customInstructions)`. The command is a control action, not a normal chat message.

## Automatic Compaction

OpenWaggle asks Pi to compact before the next model request when context reaches a global percentage of the active model's reported window. The default is **80%**. Change it in **Settings > General > Context compaction**; the value applies to every project and session.

The check runs at safe turn boundaries. Crossing the threshold on a completed response does not start background work while the session is idle. Pi compacts before the next user turn, or between a tool result and the next model call when an agent turn is still continuing. It never interrupts an active stream.

Pi chooses one of two mechanisms without adding provider-specific user settings:

- **Native** uses the Responses Compaction protocol only when the model transport explicitly declares support. Pi stores the returned opaque checkpoint and replays it only to the same compatible transport identity.
- **Portable** is the universal fallback. The active model creates a structured four-part handoff and Pi keeps a recent full conversation tail, including atomic tool-call/result pairs.

The append-only Pi session remains the source of truth. If you switch to an incompatible model, Pi reconstructs from raw session entries using only the target model. The previous provider is not called, so switching still works after its credit or credentials are unavailable. When the full raw reconstruction cannot fit the target window, Pi drops the oldest complete model-facing units only from that request while retaining the durable session history.

The composer context meter and compaction activity strip keep their existing information. They do not show the configured threshold or the selected mechanism.

## Branch Summaries

Branch summaries are separate from manual compaction. They apply when you select an earlier session-tree node and the current branch has downstream work that would be left behind.

When prompted, you can:

- Continue with no summary.
- Ask Pi to summarize the abandoned branch.
- Provide custom summary instructions through the composer.
- Cancel and return to the previous branch selection.

The custom summary text is sent to Pi's branch-summarization flow, not as a normal chat message. Pi's `branchSummary.skipPrompt` setting can skip the prompt when you prefer the no-prompt behavior.

## Model Limits

Context availability follows the selected Pi model's reported context window. OpenWaggle displays that value in the composer and uses the global percentage to configure Pi's runtime compaction policy.
