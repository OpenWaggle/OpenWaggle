---
title: "Browser Preview"
description: "Session tabs, browser profiles, responsive testing, capture tools, and collaborative agent control."
order: 3
section: "Developer Workflow"
---

The Browser preview is a native, Session-owned browser beside your workspace. It is the same page
whether you navigate it yourself, open a localhost port from a terminal, or let an agent inspect and
interact with it. Switching Sessions hides the old Session's views without closing them, so its page
and a background agent run can continue. Reloading trusted OpenWaggle chrome keeps those native
Session views alive. If a preview page process crashes, OpenWaggle reloads its latest URL with a
three-attempt, exponential-backoff limit. Navigating away from OpenWaggle revokes and closes every
Session view owned by that renderer.

## Open A Preview

Use `Cmd+Shift+J` on macOS or `Ctrl+Shift+J` on Windows/Linux, choose **Browser preview** in the
right panel, open an HTTP(S) link with **Open web links in: OpenWaggle**, or select a terminal port
chip. Public addresses entered without a scheme use HTTPS; localhost uses HTTP. Embedded
credentials and non-HTTP(S) schemes are rejected.

When the Session has no browser tab, the preview shortcut opens an empty launcher without creating
a native browser process. Enter an address or choose one of the HTTP-ready local servers discovered
from that Session's terminals. The launcher also shows up to eight of the ten most recent successful
preview URLs and lets you choose the tab's profile before navigation. **New browser tab** is separate
from **New terminal** and always creates an independent tab, so two explicit tabs may use the same
URL and profile. Opening the same URL/profile pair from a link reuses its existing preview instead.

Each Session has its own bounded tab list and remembers its current tab. Back, forward,
reload/stop, the address field, and **Open in system browser** are always visible. Use the options
menu for hard reload, detached DevTools, picture-in-picture, zoom, appearance emulation, and
clearing cookies or cache.

A Session keeps at most eight browser tabs. If a background agent needs a ninth, it replaces the
oldest tab that is neither active in the panel nor visible in the floating mini-player. If the new
native page cannot be created, OpenWaggle restores the old tab's URL, profile, mute state, viewport,
zoom, and appearance. The old page's history and in-page JavaScript state cannot be recovered after
its native view has closed.

Tabs show the page favicon and audio activity. Select the audio icon, or use the tab's context menu,
to mute or unmute it. The mute choice stays with the tab when OpenWaggle restores the workspace.

## Preview Defaults

Open **Settings > Browser** to choose the viewport, page zoom, light/dark/system appearance,
30 or 60 FPS recording rate, and whether an agent-opened preview appears in a floating mini-player.
Viewport, zoom, and appearance are applied before each new page paints; changing these defaults does
not rewrite an existing tab's controls. An explicit agent-tool visibility choice overrides the
automatic floating-preview preference.

A fresh settings store may use OpenWaggle's defaults. If the database cannot be read or a saved
current setting is invalid, OpenWaggle stops before opening the workspace. Preview creation and
restoration, recording, Web link routing, and settings writes stay blocked. **Retry** reads the same
store again; OpenWaggle does not publish replacement profiles or viewports, or send a link to the
system browser as a silent fallback.

## Responsive And Device Testing

Open the device toolbar for a responsive viewport or a named phone, tablet, foldable, or display
preset. Width and height can be edited directly, the aspect ratio can be locked, and fixed
viewports can be rotated. Closing the toolbar returns the tab to fill-panel sizing. Page zoom and
viewport emulation are independent, so changing one does not silently rewrite the other.

In fixed mode, drag the left, right, or bottom resize rail or either bottom corner. You can focus a
rail and use its arrow keys to resize by 10 CSS pixels; hold `Shift` for 50-pixel steps. The page fit
updates on the next animation frame. Pointer changes commit when you release, while keyboard changes
commit once, 150 ms after the last arrow key. Cancelling a drag restores the previous size.

The floating mini-player stays inside OpenWaggle. **Picture-in-picture** opens a separate window,
with a limit of four at once. It delivers at most one bounded frame per 100 ms and closes itself if
loading, capture, or frame delivery stalls, so the preview controls remain available.

## Profiles And Existing Logins

Every tab has one storage profile for the lifetime of its native page:

- **Default** and named profiles keep cookies and site data between app launches.
- **Incognito** uses an in-memory partition and is discarded when its views close.
- Changing a tab's profile recreates that page in the selected partition at the same URL.

Open **Settings > Browser** to choose the default, create or rename named profiles, clear their
data, or delete them. The same page can discover supported installed browsers and copy compatible
cookies into a persistent OpenWaggle profile. macOS and Linux support the listed Chromium sources;
macOS also supports Safari. Windows offers Firefox and Helium, but does not advertise Chrome, Edge,
Brave, Vivaldi, Opera, or Arc because current Chromium app-bound encryption cannot be decrypted by
OpenWaggle. The source profile is never modified. The UI tells you when the browser must be quit or
an OS credential is needed. Incognito is never an import target.

Choose an installed browser to open the guided importer. It checks whether the browser must be
quit, whether macOS Full Disk Access is required, and whether the system credential store needs
approval before it copies anything. For Full Disk Access, the importer can open the correct System
Settings page and check access again; if macOS has not refreshed the grant yet, quit and reopen
OpenWaggle. Then choose the exact source profile and either an existing persistent OpenWaggle
profile or **New profile**. A new profile keeps one stable identity across retries and is added to
Settings only after at least one cookie was written successfully. If that final save fails, its
imported data is cleared instead of leaving a hidden cookie partition. Import is a one-time copy,
not an ongoing sync. OpenWaggle scans at most 128 source profiles and accepts at most 50,000 cookie
records from a cookie database up to 256 MiB. You can keep up to 24 named OpenWaggle profiles.

## Screenshots, Recordings, And Message Context

The camera action saves a bounded PNG. Native captures use three one-second attempts with a short
compositor delay. A stalled capture releases the user or agent action queue, and OpenWaggle never
starts a second native capture on the same page while the first is unresolved.

The annotation action works directly in the preview:

- Press `V` to select elements. Shift-click adds to the selection, up to 20 elements.
- Press `R` to drag a region, `D` to draw freehand, or `E` to erase a mark.
- Expand the comment editor to preview typography, color, spacing, border, size, radius, and opacity
  changes on selected elements. These temporary page changes appear in the captured evidence and
  are restored immediately after attach or cancel.
- Press `Enter` to attach the annotation or `Escape` to cancel it.

OpenWaggle crops the screenshot around the selected elements and marks, then adds a removable
Browser preview chip to the composer. The attachment includes bounded selectors, accessible names,
HTML previews, computed styles, geometry, drawings, requested style changes, and page details for
the agent. React component, source location, and owner-stack attribution are included when the page
exposes discoverable development metadata. Production-minified or isolated pages often do not; in
that case those fields stay empty instead of being guessed. Review or remove the chip before
sending. Annotating alone does not contact a model.

Recordings are capped at two minutes and 64 MiB. They use 30 frames per second by default, with a
60 FPS option in Browser settings. Starting succeeds only after the renderer has an active
`MediaRecorder`; stopping succeeds only after the evidence file is saved. Closing the preview,
cancellation, timeout, or a failed recorder stops its tracks and releases the capture grant.

## Collaborative Agent Access

**Settings > Browser > Let agents open and drive the preview browser** controls the entire agent
capability. It is enabled by default. Turning it off removes both the `preview_*` tools and their
browser instructions from new agent turns and rejects the next preview call from a turn that is
already running; your own Browser preview remains available. A settings read failure also disables
agent access.

The agent can open or reuse the Session's current tab, navigate to a URL or localhost port, resize
and change appearance, inspect a screenshot and bounded page/console/network state, click, type,
press keys, scroll, evaluate page JavaScript, wait for conditions, and start or stop a recording.
Page-control calls use OpenWaggle's scoped approval flow. Agent and user controls share one action
queue, and real keyboard or pointer input interrupts the agent immediately, so you can take over
without racing it.

Locator actions wait for targets to appear and become actionable. Navigation or a page reload
invalidates an old locator rather than clicking the same coordinates in a new document. An agent
is instructed to diagnose this collaborative preview instead of silently opening an unrelated
automation browser after the first failure.

## Security Boundary

Preview pages run sandboxed with Node integration disabled. Permissions, device access, downloads,
certificate exceptions, unapproved popups, non-HTTP(S) navigation, and clipboard writes from page
content are denied or constrained. Session ownership is checked in Electron main before a native
view is created; a renderer-supplied Session id is not treated as authority. See
[Security & Privacy](/docs/configuration/security-privacy) for the complete boundary.
