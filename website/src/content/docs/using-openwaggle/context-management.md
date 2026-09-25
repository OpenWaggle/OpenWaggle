---
title: "Context management"
description: "Understand the context meter and keep a long conversation usable with compaction."
order: 9
section: "Using OpenWaggle"
---

A model's context window is the amount of information it can use in one request. Your messages, the agent's replies, file contents, tool results, and instructions all take space. Models measure that space in tokens, which are pieces of text rather than whole words.

You usually do not need to manage this yourself. When a conversation gets long, OpenWaggle compacts its context so work can continue. Compaction replaces older context with a shorter representation while keeping recent work available. It does not delete the saved conversation.

## Context meter

When there is enough space beside the message box, the context ring shows the percentage of the selected model's context window in use. The adjacent number is the window's token limit. Hover for usage details.

Usage comes from the runtime's context-usage snapshot, not a live estimate of each new word. It may show `?` when usage is not yet known, including after compaction until the next valid response. If loading usage fails, the tooltip says **Context usage unavailable**. The meter reports usage; it is not a control.

## Manual compaction

To compact before continuing a long task, wait until the agent is idle, type this in the message box, and send it:

```text
/compact
```

Add instructions when particular details must survive:

```text
/compact preserve the schema decisions, migration constraints, and tests still to run
```

This is a command, not a request for an ordinary reply. OpenWaggle shows compaction progress in the conversation. After it finishes, continue with your next task.

A summary may omit details. Keep lasting project conventions in project instructions and restate any critical constraint if the agent appears to have lost it.

## Automatic compaction

The default threshold is **80%** of the active model's context window. To change it, open **Settings > General > Context compaction**. The setting applies to every project and session.

Compaction happens before a model request, not while a reply is streaming. If the agent is idle when usage crosses the threshold, OpenWaggle waits until the next message. During an ongoing task, it can compact between a tool result and the next model request.

The model also needs room to reply. OpenWaggle may compact before your chosen percentage if that output reserve would otherwise run out.

### How compaction works

OpenWaggle uses the following mechanisms automatically. You do not need to select one:

- **Native** compaction uses a provider's compaction protocol when the model connection explicitly supports it. The resulting checkpoint can be reused only with a compatible connection.
- **Portable** compaction asks the active model for a structured four-part handoff and keeps the recent conversation in full. Related tool calls and results stay together.

The saved conversation remains intact. If you switch to a model that cannot use a Native checkpoint, OpenWaggle rebuilds context from the original history using the new model. It does not call the previous provider. If the new model has a smaller window, the request leaves out the oldest complete exchanges after reserving room for instructions, tools, and output. Those exchanges remain in the saved history.

The meter does not identify the mechanism or display the configured threshold. For the underlying Pi behavior, see [Compaction & Branch Summarization](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md).

## Branch summaries

A branch summary serves a different purpose. When you return to an earlier point in the [Session tree](/docs/using-openwaggle/session-tree), it can carry useful details from the work you are leaving into the new conversation branch.

When prompted, choose:

- **No summary** to continue from the earlier point without that later context.
- **Summarize** to keep a summary of the later work.
- **Custom** to write summary instructions in the message box, then send them.
- **Cancel** to return to your previous selection.

Custom text is used for the summary, not sent as an ordinary task. For advanced configuration, Pi's `branchSummary.skipPrompt` setting skips this choice prompt.

## Model limits

Context size depends on the selected model. Choosing a model with a larger window can help with a large task, but it does not make every file in your project part of the conversation. The agent still needs to read the relevant files or receive them as references and attachments.
