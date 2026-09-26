---
title: "Security and privacy"
description: "Understand what stays on your machine, what can leave it, and what permissions do not protect."
order: 2
section: "Help"
---

OpenWaggle stores conversation data locally, but a local session is not the same as a local AI request. When you use a hosted model, your messages and any file contents, attachments, or tool output included in its context are sent to that provider. The provider's data-handling policy applies.

Before working on sensitive code:

- Check the selected provider and whether your organization permits sending that code to it.
- Choose **Ask for Approval** in **Settings > Permissions** if you want to review protected actions. This does not prompt before every edit or make the session read-only.
- Review MCP servers, extensions, browser profiles, and saved approvals before using them with the project.
- Keep secrets out of messages, committed configuration, and shared logs. Review the diff before committing changes.

A local model endpoint may keep inference on your machine. Tools, extensions, browser pages, and MCP services can still access the network. OpenWaggle does not guarantee an offline workflow simply because its sessions are local.

## Local data

OpenWaggle stores app-owned settings and session records in its application-data directory. The active session database is `session-host/session-host.sqlite`. Pi, the included agent engine, also maintains session transcript files. Treat conversations, attachments, logs, and terminal history as potentially sensitive local data.

Waggle presets use separate files:

- User presets default to `~/.pi/agent/waggle-presets.json`.
- Project presets live in `<project>/.pi/waggle-presets.json`.

Provider credentials are separate from the session database. They can come from Pi's default `~/.pi/agent/auth.json`, environment variables, or custom provider configuration. `PI_CODING_AGENT_DIR` changes the default Pi directory. The credential file is JSON, not OpenWaggle's encrypted MCP vault; protect it as a secret file. Other Pi clients using that directory share the stored credentials.

MCP definitions and user-owned trust, secrets, and OAuth state have their own storage. See [MCP configuration](/docs/configuration/mcp#configuration-files). For an older installation's database recovery copy, see [Session recovery](/docs/configuration/session-recovery).

## Voice

Voice transcription runs locally. OpenWaggle may download speech-model files on first use, but does not send audio to an external speech-to-text provider. Once you send the transcribed text as a message, it follows the same model-provider data path as typed text.

## Terminal and Pi Bash

The built-in terminal is an interactive shell you control, not a sandbox. Its commands and child processes can read files and credentials available to that shell.

Each terminal receives a fresh snapshot of the app's environment so toolchains, locale, authentication sockets, proxies, display settings, and exported variables remain usable. OpenWaggle removes its own control variables and known Electron/Node code-injection variables before launch. It also removes AppImage runtime paths on Linux and sets terminal capability markers. This cleanup is not a secret filter.

Terminal output is retained locally under the app's application-data directory so panes can restore recent scrollback. Each terminal is capped at 5,000 lines and 10 MiB. Storage uses user-private directory and file permissions on platforms that support them. Closing a pane or tab, or deleting its session, deletes that terminal's retained history.

After a full app restart, OpenWaggle sanitizes terminal queries, clipboard controls, input modes, and full-screen terminal state before replaying old output. This does not mean retained text contains no secrets.

### Terminal links and selections

Use Cmd-click on macOS or Ctrl-click on Windows and Linux to follow terminal links. OpenWaggle accepts HTTP and HTTPS links, safe `file:` links, and recognized file references. Other schemes are rejected.

Files within the session's working directory can open inside OpenWaggle. Files outside it can open only in your remembered choice of supported external editor. Opening an external file this way does not grant the agent access to that location.

**Add selection to chat** puts selected terminal output into a removable item beside the message draft. It includes the working path and checkout information, and marks the text as untrusted output. It is not sent to the model until you send the draft. Treat command output as potentially misleading or malicious even when a local command produced it.

The agent's Pi `bash` tool is separate from the built-in terminal. Do not assume the terminal's chosen shell, startup integration, or environment cleanup also applies to agent tool calls.

## Browser previews

When **Settings > General > Open web links in** is set to **OpenWaggle**, web links use a browser preview owned by the session. Its page process is sandboxed and has Node integration disabled. It denies permission requests except sanitized clipboard writes. Downloads, device access, certificate exceptions, embedded URL credentials, unapproved popups, and non-HTTP/HTTPS navigation are blocked. You can explicitly open the current URL in your system browser instead.

A hidden preview may stay alive so background agent work can continue. Closing it, deleting its session, closing the app window, or quitting the app ends it. Reloading the trusted OpenWaggle interface retains its previews; navigating that interface away from the trusted app document closes them. A crashed preview page gets at most three automatic reload attempts in 30 seconds. Navigation, replacement, or closing the tab cancels pending recovery.

### Profiles and imported cookies

Persistent browser profiles keep separate cookies and site data. Incognito uses an in-memory profile. Importing cookies copies supported records into an OpenWaggle profile and never writes back to the source browser. Decrypting a selected source may use your operating system's credential helper.

Windows imports support Firefox and Helium only. Other Chromium sources are not offered there because OpenWaggle cannot safely decrypt Chrome 127 and later app-bound cookie encryption.

Imported cookies may give the preview access to signed-in accounts. Review that access before letting an agent use the profile. Incognito does not hide network traffic or prevent a website from receiving submitted data.

### Agent browser access

Control access separately in **Settings > Browser > Let agents open and drive the preview browser**. When disabled, or if the setting cannot be read, OpenWaggle withholds browser tools and their instructions. Browser operations recheck this permission, including during work already in progress.

Enabled operations still use scoped approvals, session ownership checks, and cancellation limits. Your input interrupts agent control. See [Approvals and permissions](/docs/configuration/approvals-permissions).

### Annotations

Browser annotations run separately from the page's own JavaScript. OpenWaggle limits the size of selected elements, regions, drawings, text, and page metadata before accepting an annotation. Temporary style previews are restored after a screenshot or cancellation.

Selectors, HTML, computed styles, and other page-derived details are marked as untrusted content in the attachment. Creating an annotation does not send it until you send the message draft. React source information is included only when the page exposes reliable development metadata.

## Electron boundary

For readers checking the desktop app's technical protections, the app interface runs with Node integration disabled, context isolation enabled, a sandbox, and a strict Content Security Policy. It communicates with privileged app functions through a typed preload bridge.

Those protections separate the interface from privileged operations. They do not sandbox your terminal, prove that an extension is trustworthy, or prevent a provider request from containing code you asked the agent to inspect.
