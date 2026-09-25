---
title: "Browser preview"
description: "Open your running web app, check different screen sizes, and send visual feedback to the agent."
order: 4
section: "Using OpenWaggle"
---

Browser preview opens a web page inside OpenWaggle. Use it to check the app you are building and show the agent what needs changing. You and the agent use the same page, so you can inspect its actions or take over.

Each session has its own browser tabs. Switching sessions hides the previous session's pages without closing them.

## Open a preview

1. Start your project's development server with a saved [Project action](/docs/configuration/project-actions) or in the [built-in terminal](/docs/developer-workflow/built-in-terminal), using the command your project documents.
2. Press `Cmd+Shift+J` on macOS or `Ctrl+Shift+J` on Windows and Linux.
3. Enter the server's URL, such as `http://localhost:3000`, or choose a detected local server from the launcher.
4. Use the page normally. Back, forward, reload, and the address field work like browser controls.

You can also choose **Browser preview** in the right panel. A development-server action can detect its URL from output and open a preview when ready if **Open preview when ready** is enabled. Starting an action does not mean the server is ready yet.

To open links and terminal port chips here, set **Settings > General > Links > Open web links in** to **OpenWaggle**.

Public addresses entered without a scheme use HTTPS; localhost uses HTTP. Only HTTP and HTTPS are supported, and URLs with embedded credentials are rejected.

To send feedback, choose **Annotate preview for message**, select an element or draw a region, and press `Enter`. Review the new chip in your message draft, add your instructions, and send. See [Screenshots, recordings, and message context](#screenshots-recordings-and-message-context) for annotation controls.

### Tabs and navigation

If the session has no browser tab, the shortcut opens a launcher. Choose a detected terminal server, enter an address, or select a recent URL. You can choose a browser profile before opening the page. **New browser tab** is separate
from **New terminal** and always creates an independent tab, so two explicit tabs may use the same
URL and profile. Opening the same URL/profile pair from a link reuses its existing preview instead.

Each session remembers its tabs and which one is selected. Back, forward,
reload/stop, the address field, and **Open in system browser** are always visible. Use the options
menu for hard reload, detached DevTools, picture-in-picture, zoom, appearance emulation, and
clearing cookies or cache.

A session keeps at most eight browser tabs. If a background agent needs a ninth, it replaces the
oldest tab that is neither active in the panel nor visible in the floating mini-player. If the replacement page cannot open, OpenWaggle restores the old tab's URL, profile, mute state, viewport, zoom, and appearance. The old page's browsing history and unsaved in-page state cannot be recovered after it closes.

Tabs show the page favicon and audio activity. Select the audio icon, or use the tab's context menu,
to mute or unmute it. The mute choice stays with the tab when OpenWaggle restores the workspace.

## Preview defaults

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

## Responsive and device testing

Open the device toolbar for a responsive viewport or a named phone, tablet, foldable, or display
preset. Width and height can be edited directly, the aspect ratio can be locked, and fixed
viewports can be rotated. Closing the toolbar returns the tab to fill-panel sizing. Page zoom and
viewport emulation are independent, so changing one does not silently rewrite the other.

In fixed mode, drag the left, right, or bottom resize rail or either bottom corner. You can focus a
rail and use its arrow keys to resize by 10 CSS pixels; hold `Shift` for 50-pixel steps. The preview fits the selected size inside the panel. Cancelling a drag restores the previous size.

The floating mini-player stays inside OpenWaggle. **Open picture-in-picture** in the options menu opens a separate window. OpenWaggle limits these windows and closes a stalled picture-in-picture view rather than blocking the main preview controls.

## Profiles and existing logins

A browser profile keeps a set of cookies and site data. Use different profiles to test separate accounts without signing out each time.

- **Default** and named profiles keep cookies and site data between app launches.
- **Incognito** keeps data only in memory and discards it when its pages close.
- Changing a tab's profile reloads the same URL using that profile's data. Unsaved page state is lost.

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
Settings page and check access again; if macOS has not recognized the permission yet, quit and reopen
OpenWaggle. Then choose the exact source profile and either an existing persistent OpenWaggle
profile or **New profile**. Review the import result before opening the site. Import is a one-time copy,
not an ongoing sync.

## Screenshots, recordings, and message context

Choose **Capture screenshot** to save a PNG of the preview. For feedback attached to a message, choose **Annotate preview for message** instead:

1. Select an element, or draw a region around the part you want to discuss.
2. Add a comment or temporary style changes to show what you mean.
3. Press `Enter` to attach it to your draft, or `Escape` to cancel.
4. Review the **Browser preview** chip, write your request, and send it.

For example, ask: "On this phone-sized page, keep the checkout button visible without covering the order total."

Annotation shortcuts:

- Press `V` to select elements. Shift-click adds to the selection, up to 20 elements.
- Press `R` to drag a region, `D` to draw freehand, or `E` to erase a mark.
- Expand the comment editor to preview typography, color, spacing, border, size, radius, and opacity
  changes on selected elements. These temporary page changes appear in the captured evidence and
  are restored immediately after attach or cancel.
- Press `Enter` to attach the annotation or `Escape` to cancel it.

OpenWaggle crops the screenshot around the selected elements and marks, then adds a removable
Browser preview chip to the message draft. The attachment includes size-limited selectors, accessible names,
HTML previews, computed styles, geometry, drawings, requested style changes, and page details for
the agent. React component, source location, and owner-stack attribution are included when the page
exposes discoverable development metadata. Production-minified or isolated pages often do not; in
that case those fields stay empty instead of being guessed. Review or remove the chip before
sending. Annotating alone does not contact a model.

Recordings are capped at two minutes and 64 MiB. They use 30 frames per second by default, with a
60 FPS option in Browser settings. Choose **Start preview recording**, reproduce the interaction, then choose **Stop preview recording**. OpenWaggle reports completion after saving the file. Closing the preview, cancelling, reaching the limit, or a recorder failure stops capture.

## Collaborative agent access

**Settings > Browser > Let agents open and drive the preview browser** controls the entire agent
capability. It is enabled by default. Turning it off removes both the `preview_*` tools and their
browser instructions from new agent turns and rejects the next preview call from a turn that is
already running; your own Browser preview remains available. A settings read failure also disables
agent access.

The agent can open or reuse the session's current tab, navigate to a URL or localhost port, resize
and change appearance, inspect a screenshot and limited page, console, and network details, click, type,
press keys, scroll, evaluate page JavaScript, wait for conditions, and start or stop a recording.
Page-control calls use OpenWaggle's scoped approval flow. Agent and user controls share one action
queue, and real keyboard or pointer input interrupts the agent immediately, so you can take over
without racing it.

Locator actions wait for targets to appear and become actionable. Navigation or a page reload
invalidates an old locator rather than clicking the same coordinates in a new document. An agent
is instructed to diagnose this collaborative preview instead of silently opening an unrelated
automation browser after the first failure.

## Security boundary

Preview pages run in a sandbox and cannot use Node.js APIs. Device access, downloads, certificate exceptions, popups, non-HTTP(S) navigation, and page-initiated clipboard writes are denied or restricted. OpenWaggle checks that each page belongs to the session controlling it. See [Security and privacy](/docs/configuration/security-privacy) for details.

### Recovery and capture limits

Reloading the OpenWaggle interface keeps preview pages alive. If a page process crashes, OpenWaggle tries to reload its latest URL up to three times, with increasing delays. Navigating the containing app window away from OpenWaggle closes its preview pages.

If a screenshot fails, check the error and let the page finish loading before retrying. Capture timeouts release the controls, but OpenWaggle will not start another capture on that page while an earlier capture is still unresolved.
