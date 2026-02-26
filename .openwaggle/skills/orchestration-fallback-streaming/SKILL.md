---
name: orchestration-fallback-streaming
description: Harden TanStack orchestration fallback handoff so renderer streams do not terminate before classic fallback output arrives. This skill should be used when fallback runs appear to stop early, return partial output, or only rehydrate after conversation reload.
---

# Orchestration Fallback Streaming

## Overview

Diagnose and fix fallback handoff bugs between orchestrated and classic agent execution in Electron + TanStack streaming flows. Keep stream lifecycle coherent across `service`, `agent-handler`, and renderer IPC adapter boundaries.

## When To Use

Use this skill when any of these symptoms appear:
- Fallback output is missing in the active chat stream.
- The run ends with `RUN_ERROR` or `RUN_FINISHED` before classic fallback response tokens arrive.
- The final answer appears only after switching threads or reloading conversation state.

## Workflow

1. Map the stream contract end-to-end.
- Inspect `src/main/orchestration/service.ts`, `src/main/ipc/agent-handler.ts`, and `src/renderer/src/lib/ipc-connection-adapter.ts`.
- Confirm which component owns terminal chunk emission (`RUN_ERROR`, terminal `RUN_FINISHED`) for each execution path.

2. Enforce fallback handoff semantics.
- On orchestration failure that should fall back, return fallback status without emitting terminal chunks from orchestration service.
- Let the caller (`agent-handler`) invoke classic `runAgent(...)` and let that path emit stream lifecycle events.

3. Preserve renderer adapter assumptions.
- Keep `isTerminalChunk` semantics strict: only terminal `RUN_FINISHED` (not `finishReason: 'tool_calls'`) and `RUN_ERROR` should close the consumer.
- Avoid introducing a second terminal producer for the same logical run.

4. Lock behavior with tests.
- Add or update unit tests around orchestration fallback behavior in `src/main/orchestration/*.test.ts`.
- Verify the orchestration failure path emits no chunks before fallback handoff.
- Run `pnpm test:unit`, `pnpm test:integration`, and `pnpm check`.

## Guardrails

- Do not emit `RUN_ERROR`/terminal `RUN_FINISHED` in an intermediate layer when the run will continue through fallback.
- Do not duplicate finalization paths across orchestration and classic execution for the same request.
- Keep persistence and IPC behavior aligned: emitted chunks must match what is eventually stored.
