---
title: "Attachments and voice input"
description: "Share a file or screenshot with the agent, or dictate a message and review it before sending."
order: 2
section: "Using OpenWaggle"
kind: "guide"
---

Attach a file when the agent needs something from outside the project, such as a screenshot, sample data or a document. When the file is already in your repository, reference it instead, so the agent reads the current version. You can also dictate a message instead of typing it.

## Attach files

Click **+** beside the message box to open its menu:

![The composer's + menu open, with Attach files, Reference project file, Use a skill and Start Waggle](/screenshots/composer-plus-menu.png)

1. Choose **Attach files** and pick the files, or drag files onto the message box.
2. Check the file chips above your draft. Click a chip's X to remove a file.
3. Say what the agent should do with the files, then send the message.

For example:

```text
Compare this screenshot with the checkout page in our app.
List the differences before making any changes.
```

You can attach up to 5 files to a message, each up to 8 MiB and 20 MiB in total. Nothing is sent until you send the message. With a hosted model, the attachment content in the request goes to that provider.

The rest of the **+** menu:

- **Reference project file** picks a file from your project. Typing `@` in the message box does the same.
- **Use a skill** picks a skill, a set of instructions for one kind of task. Typing `/` opens the same list, together with commands and Waggle presets.
- **Start Waggle** picks a saved Waggle preset, so two agents work on the message in turns. See [Waggle mode](/docs/using-openwaggle/waggle-mode).
- **Use MCP servers**, under **This Session**, appears once the session has started. Clear it to stop this session's MCP servers. See [MCP](/docs/configuration/mcp).

## What the agent receives

| File type | What the agent gets |
|-----------|---------------------|
| Text and documents | The extracted text, for files such as `.txt`, `.csv`, `.json`, `.xml`, `.html`, `.docx`, `.rtf` and `.odt`. |
| PDF | The extracted text with its page structure, not the PDF itself. |
| Image | The image, if the model accepts images, plus any text read from it by optical character recognition. |

OpenWaggle saves attachments with the session, as their details and extracted text. It loads image and PDF data again when a request needs it.

Not every model can look at images. OpenWaggle goes by what the selected model says it supports. A model without image input gets only the extracted text, which says nothing useful about layout, colors or diagrams. For those tasks, choose a model that accepts images.

## View images in the conversation

Images you or the agent share appear in the conversation. Click one to zoom, pan, or move through that message's images. To browse every image in the session, open one from [Session Summary and resources](/docs/using-openwaggle/session-summary). The viewer can download a copy, or open the original file when it is still on your computer.

When the agent's reply shows a local image, OpenWaggle can save it with the session's outputs. This works for PNG, JPEG, GIF and WebP files referenced by a `file:` URL or an absolute path, in the session's working folder or a supported temporary evidence folder. OpenWaggle checks the image and keeps its own copy, so it doesn't depend on a temporary file staying where it was. Images elsewhere, or in other formats, or too large, may not be saved.

## Dictate a message

Click the microphone beside the message box to speak instead of typing. OpenWaggle turns your speech into text on your computer.

1. Click the microphone.
2. Speak while the waveform and timer show that it is recording.
3. Click the square stop button or press `Enter` to stop. OpenWaggle writes out what you said.
4. Read the text, fix names and code terms, and send it as usual.

To skip the review, click the send button while recording. OpenWaggle stops, writes out the text and sends it in one go.

Voice input needs macOS 13.4 or later on a Mac.

### Where your voice goes

OpenWaggle uses the Whisper base model on your computer, with automatic language detection, and never sends the audio to another service. The first time, it needs an internet connection to download the model. It then keeps the model in the `models/` folder of the [app data folder](/docs/reference/data-locations#what-is-in-the-app-data-folder) and unloads it from memory after 5 minutes without use.

The text it writes is an ordinary message. When you send it to a hosted model, that provider gets the text.

### When dictation fails

If transcription fails or OpenWaggle hears no speech, a message appears above the message box. Close it, or start a new recording to clear it.
