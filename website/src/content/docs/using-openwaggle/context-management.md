---
title: "Context Management"
description: "Pi-reported context usage and manual /compact support."
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

Automatic compaction policy belongs to Pi. OpenWaggle does not implement a separate automatic compaction layer.

## Branch Summaries

Branch summaries are separate from manual compaction. They apply when you select an earlier session-tree node and the current branch has downstream work that would be left behind.

When prompted, you can:

- Continue with no summary.
- Ask Pi to summarize the abandoned branch.
- Provide custom summary instructions through the composer.
- Cancel and return to the previous branch selection.

The custom summary text is sent to Pi's branch-summarization flow, not as a normal chat message. Pi's `branchSummary.skipPrompt` setting can skip the prompt when you prefer the no-prompt behavior.

## Model Limits

Context availability follows the selected Pi model's reported context window. OpenWaggle displays that value in the composer and uses Pi's compaction behavior for runtime context management.
