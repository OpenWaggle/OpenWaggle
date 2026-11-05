---
title: "Browser preview"
description: "Open your running web app, check different screen sizes, and send visual feedback to the agent."
order: 4
section: "Using OpenWaggle"
kind: "guide"
---

The browser preview opens a web page inside OpenWaggle. Use it to check the app you are building and to show the agent what needs changing. You and the agent see the same page, so you can watch what it does and take over at any point.

Each session has its own browser tabs. Switching sessions hides the previous session's pages without closing them.

## Open a preview

1. Start your project's development server with a [project action](/docs/configuration/project-actions) or in the [built-in terminal](/docs/developer-workflow/built-in-terminal).
2. Press `Cmd+Shift+J` on macOS or `Ctrl+Shift+J` on Windows and Linux.
3. Enter the server's address, such as `http://localhost:3000`, or choose a server the launcher found in your terminals.
4. Use the page as you would in a browser. Back, forward, reload and the address field work as usual.

![A session with the browser preview on the right showing a local dashboard page, and the conversation about it on the left](/screenshots/feature-browser-preview.png)

You can also choose **Browser** on the right panel rail. A development-server action can find its address in its output and open the preview once the server responds, if you set the action to open the preview when it is ready. Starting the action does not mean the server is ready yet.

To open links and terminal port chips here instead of in your system browser, set **Settings > General > Links > Open web links in** to **OpenWaggle**.

An address without a scheme uses HTTPS, except `localhost`, which uses HTTP. The preview opens only HTTP and HTTPS addresses, and refuses addresses with a user name or password in them.

## Work with tabs

If the session has no browser tab, the shortcut opens a launcher. Choose a server found in your terminals, type an address, or pick a recent one. You can pick a browser profile before the page opens.

**New browser tab** always opens a separate tab, even for an address and profile another tab already uses. Opening a link reuses the tab that already shows that address with that profile.

The toolbar always shows back, forward, reload or stop, the address field, and **Open in system browser**. The options menu has **Hard reload**, **Open DevTools** in a separate window, picture-in-picture, zoom, light and dark appearance, and clearing cookies or the cache.

Each session remembers its tabs and which one is selected, and keeps at most eight. When a background agent needs a ninth, OpenWaggle replaces the oldest tab that is neither showing in the panel nor in the floating mini-player. If the new page cannot open, OpenWaggle restores the old tab's address, profile, mute state, viewport, zoom and appearance. The old page's history and anything unsaved on it are gone once it closes.

Tabs show the page's icon and whether it is playing sound. Click the sound icon, or use the tab's menu, to mute or unmute it. A muted tab stays muted when OpenWaggle restores your workspace.

If a page fails to close, its tab stays so you can try again. When you close several tabs, only those that closed go away. Switching sessions while a tab closes does not open a sidebar in the other session.

Tabs you open in a new session before its first message move into the session when you send that message. If they cannot move safely, they stay with the project's draft and an error explains why. Use the project's **New session** to get back to them.

## Set preview defaults

Open **Settings > Browser** to choose the default viewport, page zoom, appearance (light, dark or system), recording rate (30 or 60 frames per second), and whether a preview the agent opens appears in a floating mini-player. OpenWaggle applies the viewport, zoom and appearance before a new page first draws. Changing a default does not change tabs that are already open. When the agent asks for a tab to be visible or hidden, that wins over the mini-player setting.

If OpenWaggle cannot read its settings, or a saved setting is invalid, it stops before opening the workspace. Opening and restoring previews, recording, sending links to the preview, and saving settings stay blocked until you choose **Retry**, which reads the settings again. OpenWaggle does not fall back to default profiles or viewports, or send links to your system browser instead.

## Test different screen sizes

Choose **Open device toolbar** in the options menu for a responsive viewport or a named phone, tablet, foldable or display size. You can type a width and height, lock the aspect ratio, and rotate a fixed size. Closing the toolbar makes the page fill the panel again. Page zoom and viewport size are separate, so changing one leaves the other alone.

At a phone size like iPhone SE, a layout problem that is easy to miss at panel width shows up at once, such as a card running off the right edge.

![The device toolbar set to iPhone SE at 375 by 667, with width and height fields, lock, rotate and close buttons, and the page drawn at phone size](/screenshots/browser-preview-device-toolbar.png)

With a fixed size, drag the left, right or bottom edge of the page, or either bottom corner. You can also focus an edge and use the arrow keys to resize by 10 CSS pixels, or 50 with `Shift`. The preview scales the page to fit the panel. Cancelling a drag puts the previous size back.

The floating mini-player stays inside the OpenWaggle window. **Open picture-in-picture** in the options menu opens a separate window instead. OpenWaggle limits how many of these windows open, and closes one that stops responding rather than letting it block the main preview.

## Use profiles and existing logins

A browser profile keeps its own cookies and site data. Use separate profiles to test different accounts without signing out each time.

- **Default** and named profiles keep cookies and site data between launches.
- **Incognito** keeps data only in memory. OpenWaggle clears it when you quit, not when you close its tabs.
- Changing a tab's profile reloads the same address with that profile's data. Anything unsaved on the page is lost.

In **Settings > Browser** you can choose the default profile, create and rename profiles, clear their data, and delete them. The same page finds browsers installed on your computer and can copy their cookies into a lasting OpenWaggle profile, never into **Incognito**.

| System | Browsers you can import from |
| --- | --- |
| macOS | The listed Chromium browsers, and Safari |
| Linux | The listed Chromium browsers |
| Windows | Firefox and Helium |

Windows does not offer Chrome, Edge, Brave, Vivaldi, Opera or Arc, because their current app-bound encryption keeps OpenWaggle from reading the cookies.

Choose a browser to open the importer. Before copying anything, it checks whether you need to quit that browser, whether macOS needs Full Disk Access for OpenWaggle, and whether your system's credential store needs your approval. For Full Disk Access, the importer can open the right page in System Settings and check again; if macOS still has not noticed the permission, quit and reopen OpenWaggle. Then pick the source profile, and an existing OpenWaggle profile or **New profile**. Check the result before you open the site. The import copies cookies once. It does not keep them in sync, and it never changes the source browser's profile.

## Send visual feedback to the agent

Choose **Capture screenshot** to save a PNG of the preview. To attach feedback to a message, choose **Annotate preview for message** instead:

1. Select an element, or draw a region around the part you want to talk about. Clicking the gap between two elements selects the element that holds them both.
2. Add a comment, or try temporary style changes to show what you mean.
3. Press `Enter` to attach the annotation to your draft, or `Escape` to cancel.
4. Check the chip in your draft, write your request, and send it.

![Annotation tools over a phone-sized page, with a row of cards selected, its selector shown, and a comment box with an Attach button](/screenshots/browser-preview-annotation.png)

The chip shows your comment, or the selected element's text or selector if you wrote none, with the page title and the number of elements. Remove it with its close button.

![The message box with an annotation chip showing the comment, the page title and 1 element, and the request typed below it](/screenshots/browser-preview-annotation-chip.png)

For example, ask: "On this phone-sized page, stack the stat cards in one column so none of them is cut off."

While you annotate:

- Press `V` to select elements. `Shift`-click adds to the selection, up to 20 elements.
- Press `R` to drag a region, `D` to draw freehand, or `E` to erase a mark.
- Expand the comment editor to try typography, colour, spacing, border, size, radius and opacity changes on the selected elements. The screenshot shows these changes, and OpenWaggle undoes them on the page as soon as you attach or cancel.
- Press `Enter` to attach, or `Escape` to cancel.

OpenWaggle crops the screenshot around your selection and marks, and adds it to your draft as a **Browser preview** chip. For the agent, it also includes selectors, accessible names, short HTML excerpts, computed styles, positions, your drawings and style changes, and page details, each with a size limit. When the page exposes development information, it adds the React component, its source location and its owner stack. Production builds and isolated pages often do not, and then those fields stay empty rather than guessed. Annotating does not contact a model; nothing is sent until you send the message.

## Record the preview

Choose **Start preview recording**, go through the interaction, then choose **Stop preview recording**. OpenWaggle tells you when the file is saved. A recording lasts at most two minutes and 64 MiB, at 30 frames per second unless you chose 60 in **Settings > Browser**. Closing the preview, cancelling, reaching a limit, or a recorder error stops it.

## Let the agent use the preview

**Settings > Browser > Let agents open and drive the preview browser** turns the agent's access on or off. It is on by default. Turning it off removes the `preview_*` tools and their instructions from new agent turns, and makes a turn that is already running fail its next preview call. Your own preview keeps working. If OpenWaggle cannot read the setting, it turns agent access off.

The agent can open or reuse the session's current tab, go to an address or a localhost port, resize the page and change its appearance, and read a screenshot plus some of the page, console and network details. It can click, type, press keys, scroll, run JavaScript on the page, wait for something to happen, and start or stop a recording. Actions that control the page go through OpenWaggle's approval settings. You and the agent share one queue of actions, and any real keyboard or mouse input from you interrupts the agent at once, so you can take over without racing it.

When the agent targets an element, it waits for the element to appear and be ready. After the page navigates or reloads, an old target no longer works, so the agent never clicks the same spot on a different page. The agent is told to work out what went wrong in this preview, rather than quietly opening a separate automation browser after the first failure.

## What pages can and cannot do

Preview pages run in a sandbox without Node.js access. OpenWaggle denies or limits device access, downloads, certificate exceptions, pop-ups, navigation to anything other than HTTP and HTTPS, and clipboard writes started by the page. It checks that each page belongs to the session that controls it. See [Security and privacy](/docs/configuration/security-privacy).

## If a page crashes or a capture fails

Reloading the OpenWaggle window keeps preview pages open. If a page's process crashes, OpenWaggle reloads its last address up to three times, waiting longer each time. If the OpenWaggle window itself navigates away, its preview pages close.

If a screenshot fails, read the error and let the page finish loading before you try again. When a capture times out, the controls work again, but OpenWaggle does not start another capture on that page until the earlier one finishes.
