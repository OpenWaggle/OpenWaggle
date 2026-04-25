---
title: "Attachments & Voice Input"
description: "How to attach files to messages and use local speech-to-text voice input in OpenWaggle."
order: 3
section: "Using OpenWaggle"
---

## Attachments

Attach files to your messages for the agent to analyze.

### Supported Formats

- **Text files** — Content extracted directly (including `.txt`, `.csv`, `.json`, `.xml`, `.html`, `.docx`, `.rtf`, `.odt`).
- **PDFs** — Text extracted with page structure preserved.
- **Images** — Sent as image content when the selected Pi model reports image input support. OCR text is also included in the prompt summary.

### How to Attach

- Click the **+** button in the composer toolbar.
- Or drag and drop files onto the composer.

Up to **5 files** can be attached per message. Attachment chips appear above the text input showing filenames. Click the X on any chip to remove it.

Attachments are persisted in the session as metadata and extracted text. Image/PDF binary data is hydrated by the main process only when needed for a run.

### Attachment Support by Model

OpenWaggle follows Pi model metadata. If a selected model supports image input, image attachments are sent as image content. Otherwise, the extracted text summary is still included. PDFs are currently text-extracted before sending rather than passed as native PDF payloads.

## Voice Input

OpenWaggle includes local speech-to-text powered by Whisper, running entirely on your machine.

### How to Use

1. Click the **microphone** button in the composer toolbar.
2. Speak your message. You'll see a live audio waveform and duration timer.
3. Press the **stop** button (square icon) or press **Enter** to end recording and transcribe into the composer input.
4. Press the **send** button while recording to stop, transcribe, and send immediately in one step.
5. If you stop instead of sending, you can edit the transcribed text before sending it normally.

### Privacy

All audio processing happens locally using Whisper. The composer now prefers the higher-accuracy local base model with automatic language detection. No audio data is sent to any external service. Models are cached in your app data directory and idle models are unloaded automatically after several minutes.

### Errors

If local transcription fails or no speech is detected, the composer shows an inline message above the input. You can dismiss that message with the close button or start a new recording to clear it.
