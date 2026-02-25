# Bug: Reasoning chunks accumulate into a single component

## Status
Resolved

## Severity
P1 — UX regression in orchestration streaming

## Description

During orchestration streaming, reasoning/thinking chunks (`STEP_STARTED`/`STEP_FINISHED`) are accumulated into a single reasoning component instead of creating a new component for each reasoning step. This means the user sees one ever-growing reasoning block instead of multiple discrete reasoning components appearing over time as the stream progresses.

## Expected Behavior

Each reasoning step should produce its own separate reasoning component in the UI. As the orchestration stream progresses, users should see multiple reasoning components appear sequentially — giving real-time visibility into the agent's thinking process.

## Actual Behavior

All reasoning text is concatenated into a single reasoning component. The user only sees one block that grows larger, and cannot distinguish between separate reasoning steps. This makes the reasoning feel like a wall of text rather than an incremental thought process.

## Reproduction

1. Enable orchestration mode with a reasoning/thinking model
2. Ask a question that triggers multi-step reasoning (e.g., "go to tanstack ai docs and tell me what that library is about")
3. Observe that all reasoning text appears in a single component instead of multiple separate components

## Root Cause (Investigation Needed)

The orchestration streaming path likely combines `STEP_STARTED`/`STEP_FINISHED` chunks into a single message part rather than creating new parts for each reasoning step. The issue is in how the orchestration service emits thinking chunks and/or how the renderer accumulates them.

Key files to investigate:
- `src/main/orchestration/service.ts` — how thinking chunks are emitted during orchestration streaming
- `src/main/agent/message-mapper.ts` — how thinking chunks map to message parts
- `src/renderer/src/components/chat/` — how reasoning components are rendered from message parts

## Root Cause

`StreamPartCollector.handleChunk()` in `src/main/agent/stream-part-collector.ts:67-69` — the `STEP_FINISHED` case accumulated thinking text into `this.currentThinking` via `+=` but never flushed it as a separate part. All thinking deltas between `STEP_STARTED` events concatenated into one buffer, producing a single `thinking` part on finalization instead of one per reasoning step.

## Fix

Added `this.flushThinkingPart()` after the delta accumulation in the `STEP_FINISHED` case. Each finished step now immediately becomes its own `thinking` part in `collectedParts[]`, so the renderer receives multiple discrete `ThinkingBlock` components.

## Impact

Bad UX — users cannot see reasoning appear incrementally during streaming, which defeats the purpose of showing reasoning at all.
