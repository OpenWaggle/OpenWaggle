# Voice Recorder Visualizer Redesign

**Status:** In Progress
**Priority:** P2
**Severity:** Medium
**Depends on:** `10-whisper-model-memory-leak.md`
**Origin:** Voice UX follow-up

---

## Summary

Replace the existing synthetic voice meter with a compact inline recorder that fits inside the composer toolbar row, keeps the textarea footprint stable, feels closer to the Codex voice control, and keeps transcription local with Whisper.

## Goals

- [x] Move the composer voice flow to a local state machine: `idle -> recording -> transcribing`
- [x] Replace the DOM bar list with a real peak-driven canvas waveform
- [x] Keep the recorder inline inside the composer instead of expanding into a separate review surface
- [x] Keep the composer body height stable by replacing the model / quality / plan controls in the toolbar row during recording
- [x] Support `Stop` -> transcribe into the textarea and `Send` -> transcribe and send in one motion
- [x] Make transient voice errors dismissible from the composer
- [x] Remove high-frequency voice waveform/timer state from Zustand
- [ ] Follow up with any polish or regressions found during QA

## Files

- `src/renderer/src/components/composer/useVoiceCapture.ts`
- `src/renderer/src/components/composer/VoiceRecorder.tsx`
- `src/renderer/src/components/composer/voice-utils.ts`
- `src/renderer/src/components/composer/Composer.tsx`
- `src/renderer/src/components/composer/ComposerToolbar.tsx`
- `src/renderer/src/stores/composer-store.ts`

## Review Notes

- The renderer now owns recorder animation/playback state locally, so the global composer store only tracks stable composer data.
- The shipped interaction is intentionally compact: microphone starts inline capture, `Stop` inserts the transcript into the textarea, and `Send` auto-sends the transcribed text.
- During recording/transcribing, the waveform replaces the toolbar controls instead of replacing the textarea, so the composer keeps its normal height.
- The recorder still uses local Whisper via `voice:transcribe-local`, but it now prefers the higher-accuracy local base model with language auto-detection; no backend or privacy model changes are required.
