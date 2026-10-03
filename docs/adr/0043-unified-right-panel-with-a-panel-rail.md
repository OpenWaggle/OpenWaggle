# Unified right panel with a panel rail

Status: accepted

Date: 2026-10-01

Supersedes in part: [ADR 0035](0035-native-project-actions.md), its rule that "the header keeps a stable + Action entry point".

Refines: [ADR 0038](0038-guided-action-panel.md), which keeps its restore-on-close claim and now highlights Project Actions on the rail.

The right side of the window had grown one header button per surface (Changes, Session Tree, Session Hub, Terminal, + Action) plus extension side panels reachable only from the command palette. Two separate right-side containers also existed: route panels (Changes, Session Tree, Resources, files, extension panels) and the workspace panel (Browser, Terminal, action output), each with its own width, narrow-window breakpoint and tab strip. Three interactive prototypes were compared: a Codex-style launcher tab inside the panel, a VS Code-style icon rail on the panel's edge, and a header switcher menu. The maintainer chose the rail.

## Decision

- **One Right panel container.** Every Right panel surface shares one container, one user-level width and one narrow-window rule (a sheet over the chat below the narrow-window threshold). The workspace panel's mixed tab strip is removed; Browser tabs and Terminal tabs stay inside their own surfaces.
- **The Panel rail is the navigation.** A vertical icon strip on the panel's right edge, below the header: the fixed **All panels** entry first, then the user's surfaces in the user's order. Choosing an icon shows that surface; choosing the shown surface's icon closes the panel. Defaults, top to bottom: All panels, Changes, Project Actions, Browser, Files, Session Tree, Resources, then extension panels in install order.
- **Users own the rail.** Press and hold an icon to pick it up and drag it (a plain click only opens), or use ⌥↑/⌥↓ and the right-click menu. Pin from All panels and unpin from All panels or the rail's right-click menu; an unpinned surface stays listed in All panels. Reset rail restores the defaults. The rail stays visible while the panel is closed unless the user picks *Hide rail* in Settings › Appearance › Right panel (also a check in the rail's right-click menu).
- **What is remembered where.** Each Session remembers whether its panel is open, the surface it shows and whether it is maximized. The rail order, pins, rail visibility preference and panel width belong to the user and are shared by every Session. A Session with no remembered surface shows the surface the user showed most recently anywhere; a user who never showed one gets All panels.
- **The header keeps actions and status, not navigation.** Header right side: terminal toggle (icon plus up/down arrow, unchanged behaviour wherever the terminal's tabs live), Commit, Report a bug, Session Hub toggle, a Changes `+N −M` readout that opens Changes, and the Right panel toggle (⌘⌥B). The Session Tree, Changes and + Action header buttons are removed. Terminals have no rail entry; the Session Hub is not a Right panel surface and still appears only while the panel is closed.
- **Project Actions on the rail replaces + Action.** The Project Actions surface lists actions with Run and Stop, offers Add action (the guided panel of ADR 0038), shows the selected run's output and shows a running indicator on its rail icon. A run's output can open as a read-only **Action output terminal view** in the bottom drawer, attached to the same managed run.
- **Surfaces opened from elsewhere highlight their owner.** A file link highlights Files, a change request highlights Changes, the guided action panel highlights Project Actions, an agent-opened page highlights Browser. Files with no target reopens the Session's last file or shows only the navigator.
- **Extension side panels join the rail.** A side panel appears on the rail and in All panels where its extension can run. Panels whose extension cannot run yet appear only in All panels, disabled with what they need; panels an extension does not apply to, or that the user disabled, are hidden while keeping their rail position. A new panel joins the end of the rail with a New marker shown once per user. A hidden extension panel is unmounted and restores itself from its contribution instance state.
- **Extension icons are drawn by OpenWaggle in one colour.** A side panel's manifest may declare `icon` as a bundled Lucide name or as `{ "svg": "<package-relative path>" }`. OpenWaggle uses only the icon's shape and paints it in the rail's colours, as VS Code's activity bar (CSS mask over theme foreground) and Obsidian's ribbon (Lucide names plus registered SVG) do. Missing or invalid icons fall back to a letter tile with a diagnostic.
- **Every surface is reachable by keyboard.** Every surface, All panels and each extension side panel has a Shortcut registry command that toggles it like its rail icon. Existing defaults stay (⌘D Changes, ⌘⇧J Browser, ⌘⇧Y Session Tree); new commands start unassigned and extensions cannot declare default bindings. The command palette lists every surface in a Panels section with its current binding.

## Considered Options

- **Launcher tab (Codex).** Several surfaces open at once as tabs, with a + page listing tools. Rejected: it adds a second tab model on top of Browser and Terminal tabs and costs vertical space.
- **Header switcher.** One header menu with search. Rejected: the least discoverable option, and the panel's own title became a second copy of the same menu.

## Consequences

The route and workspace right sidebars share sizing and a single storage key. The renderer gains a user-level rail layout store and per-Session panel memory for route-backed surfaces. The extension SDK manifest gains an optional side-panel `icon` and its API snapshot changes; the main process validates the Lucide name or reads the package SVG once per installed content hash. The Shortcut registry gains panel commands, including dynamic extension panel commands. The user documentation for the right sidebar, Project actions, shortcuts and extension authoring changes accordingly.

Maximize applies to the one container, so every surface header has the same maximize control and switching surfaces keeps the Session's maximized state. A narrow-window sheet and the guided action panel (ADR 0038) keep their own width and offer no maximize control.
