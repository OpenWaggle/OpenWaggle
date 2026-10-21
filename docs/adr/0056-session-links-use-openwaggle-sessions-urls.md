# Session Links Use `openwaggle://sessions/<id>`

Status: accepted

A person shares a Session with another Session, a chat, or a note by copying a **Session link**: `openwaggle://sessions/<sessionId>`. We picked a link over the bare ID that T3 Code and the Codex TUI copy. A link says what it is when pasted anywhere, and opens the Session from outside the app, as Codex's `codex://threads/<id>` does. The format is public once links are pasted into issues and chats, so it must keep working.

- **Same scheme as the renderer, different host.** The renderer loads from `openwaggle://app/…` and trusts only the `app` host. Session links use the `sessions` host, and the plural path leaves room for later `projects` or `settings` links. The OS handler accepts only `sessions` with exactly one Session ID and refuses `app` and everything else: on Windows and Linux before the app starts, and on macOS, which activates the app before it delivers the link, without focusing or creating a window for it. A Session link clicked inside the app is handled by OpenWaggle and never navigates the renderer.
- **Only packaged release builds claim the scheme from the OS.** Stable, Alpha, Beta and RC share one identity and userData (ADR 0032), so any of them can open the link. Dev builds keep isolated userData and never register. Otherwise the most recent `pnpm dev` would take over link handling and open a build that lacks the Session. Dev builds still copy links and handle links clicked inside the app. macOS declares the scheme in the bundle, Windows registers it when the app starts, and on Linux the install script's desktop entry claims it, because nothing integrates the AppImage's own entry.
- **Opening only navigates.** A link to an existing Session, in any project and including a Worker, brings the most recently focused window forward and selects it. A link to an archived Session opens it with the archived notice and does not restore it. A link to an unknown Session shows "Session not found" and keeps the current page. Links that arrive before the renderer is ready are queued like open-project requests and handed out once. Opening never starts a Run, sends a message, or changes the Session, and links carry no query parameters such as Codex's `?prompt=`.
- **Agents address a Session by its link.** The `sessions` tool and the `openwaggle sessions` CLI accept a Session link wherever they accept a Session identity, through one shared parser. Normal authorization and catalog-scope checks still apply. The Host does not detect links in messages to add linked Sessions' context to a Run, because the Agent Session identity context carries no related state and agents read it on demand.

## Considered Options

- Copying the bare Session ID (T3 Code, Codex TUI): simpler, but it opens nothing and needs explanation when pasted.
- A dedicated scheme such as `openwaggle-link://`: avoids sharing a scheme with the renderer origin, but nobody would guess it.
- Reusing the internal route `openwaggle://app/sessions/<id>`: would tie the public format to router paths and the trusted renderer origin.
- A per-dev-build scheme: links would only work in the build that copied them.
