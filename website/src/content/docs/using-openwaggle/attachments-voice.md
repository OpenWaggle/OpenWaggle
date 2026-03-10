---
title: "Attachments & Voice Input"
description: "How to attach files to messages and use local speech-to-text voice input in OpenWaggle."
order: 3
section: "Using OpenWaggle"
---

## Attachments

Attach files to your messages for the agent to analyze.

### Supported Formats

- **Text files** — Content extracted directly.
- **PDFs** — Text extracted with page structure preserved.
- **Images** — Sent natively to providers that support vision (Anthropic, OpenAI, Gemini). OCR text extraction used as fallback for other providers.

### How to Attach

- Click the **+** button in the composer toolbar.
- Or drag and drop files onto the composer.

Up to **5 files** can be attached per message. Attachment chips appear above the text input showing filenames. Click the X on any chip to remove it.

Attachments are stored as metadata only — binary content is not persisted in conversation history.

### Attachment Support by Provider

Different providers support different types of native attachments:

| Provider | Images | PDFs | Text Files |
|----------|--------|------|------------|
| Anthropic | Native | Native | Text extraction |
| OpenAI | Native | Native | Text extraction |
| Gemini | Native | Native | Text extraction |
| Grok | Text fallback | Text fallback | Text extraction |
| OpenRouter | Text fallback | Text fallback | Text extraction |
| Ollama | Text fallback | Text fallback | Text extraction |

Providers without native support receive extracted text instead, so attachments work everywhere — just with different fidelity.

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
