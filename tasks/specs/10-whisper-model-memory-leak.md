# 10 — Whisper Model Memory Leak

**Status:** Planned
**Priority:** P2
**Severity:** High
**Depends on:** None
**Origin:** H-07

---

## Problem

`src/main/ipc/voice-handler.ts:66` — `transcriberPromises` caches loaded Whisper models indefinitely. Once a user records a single voice clip, the ONNX model (~80–200MB depending on tiny vs. base) stays in memory for the entire app session.

## What Exists

- `transcriberPromises` at line 66: caches models indefinitely
- Models loaded on first use (line 118–153) and never freed
- `resetVoiceHandlerForTests()` at line 155: test-only, not runtime

## Implementation

- [ ] Add an idle eviction timer: after 5–10 minutes of no transcription calls, delete the cached model reference and let GC reclaim memory
- [ ] Track `lastUsedAt` per model. On each transcription call, reset the timer
- [ ] On eviction, log: `logger.info('Evicting idle Whisper model', { model })`
- [ ] Optionally expose a `'voice:unload-model'` IPC channel for proactive memory freeing

## Files to Touch

- `src/main/ipc/voice-handler.ts` — add eviction timer logic

## Tests

- Unit: model evicted after idle timeout
- Unit: active usage resets eviction timer

## Risk if Skipped

Long-running sessions waste 80–200MB of RAM on an idle model.
