---
title: "Attachments and voice input"
description: "Share a file or screenshot with the agent, or dictate a message and review it before sending."
order: 2
section: "Using OpenWaggle"
---

Attach a file when the agent needs something outside the project, such as a screenshot, sample data, or a document. Use a project-file reference when the file is already in your repository.

## Attachments

### How to attach

1. Click **+** beside the message box and choose **Attach files**, or drag files onto the message box.
2. Check the filename chips above your draft. Click a chip's X to remove a file.
3. Write what you want the agent to do with the files, then send the message.

For example:

```text
Compare this screenshot with the checkout page in our app.
List the differences before making any changes.
```

You can attach up to 5 files per message, up to 8 MiB each and 20 MiB in total. Attaching a file does not send it until you send the message. When you use a hosted model, the attachment content included in the request goes to that provider.

The **+** menu also includes:

- **Reference project file** to pick a file from your project. You can also type `@` in the message box.
- **Use a skill** to select task instructions. Typing `/` opens the combined command menu.
- **Start Waggle** to choose a saved multi-agent review preset.

### Supported formats

| File type | What the agent receives |
|-----------|-------------------------|
| Text and documents | Extracted text, including `.txt`, `.csv`, `.json`, `.xml`, `.html`, `.docx`, `.rtf`, and `.odt`. |
| PDF | Extracted text with page structure, rather than the original PDF as a native model input. |
| Image | The image when the model supports image input, plus extracted text from optical character recognition when available. |

Attachments are saved with the conversation's metadata and extracted text. Image and PDF data is loaded when needed for a request.

Images shared by you or the agent also appear in the conversation. Click one to zoom, pan, or move through that message's images. To browse images across the whole session, open one from [Session Summary and resources](/docs/using-openwaggle/session-summary). The viewer can download a copy or open an available local original.

Supported local images embedded in an agent's Markdown reply can be saved as session Outputs too. This includes PNG, JPEG, GIF, and WebP images referenced with a `file:` URL from the session's working directory or supported temporary evidence folders. OpenWaggle validates and copies the image rather than relying on a temporary file to remain there. Arbitrary paths and unsupported or oversized images are not guaranteed to become saved resources.

### Attachment support by model

Not every model can inspect images. OpenWaggle uses the selected model's declared capabilities. If it does not support image input, only the extracted text summary is included. That is not a substitute for visual inspection of layout, colors, or diagrams. Choose an image-capable model for those tasks.

## Voice input

You can dictate into the message box instead of typing. OpenWaggle transcribes speech locally using Whisper.

### How to use

1. Click the microphone button beside the message box.
2. Speak while the waveform and timer show that recording is active.
3. Click the square stop button or press `Enter` to stop and transcribe.
4. Review the text, correct names or code terms, and send it normally.

If you want to skip reviewing the text, click the send button while recording. It stops recording, transcribes, and sends in one action.

### Privacy

Audio processing happens on your machine. OpenWaggle uses the local Whisper base model with automatic language detection and does not send the audio to an external service. First use needs an internet connection to download the model. It is then cached in your app data directory and unloaded after several idle minutes.

The resulting text is an ordinary message. When you send it to a hosted model, that provider receives the text.

### Errors

If transcription fails or no speech is detected, an inline message appears above the input. Dismiss it with the close button or start a new recording to clear it.
