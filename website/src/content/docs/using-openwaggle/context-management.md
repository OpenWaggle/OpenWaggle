---
title: "Context Management"
description: "Pi-reported context usage and manual /compact support."
order: 4
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

## Not Present In The Current Baseline

The current Pi-native baseline does not include:

- Context inspector drawer.
- Pinned messages.
- Saved compaction guidance.
- OpenWaggle-owned model compatibility gates.
- A custom token accounting system.
