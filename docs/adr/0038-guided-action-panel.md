# Guided action panel for Project actions and Workspace preparation

Status: accepted

Date: 2026-09-28

Supersedes in part: [ADR 0035](0035-native-project-actions.md), its "Add action is a single-screen form" paragraph and its rule that saving a shared Workspace setup or cleanup leaves it disabled for the person who saved it.

The Add action modal approved in ADR 0035 was cramped and hard to follow for someone who is easily overwhelmed. It asked for every choice at once, in small text, with meaning hidden behind terms such as Task, Service and "Save to". Three round-one variants (guided steps, a split script browser, a command-first bar) were rejected as the same dense design rearranged. Round two tested plain-language structures: a panel with two required questions and the rest optional, a one-question-per-screen wizard, and a start-from-a-goal picker. The maintainer chose the first. T3 Code's single short dialog and Codex's inline environment rows informed it: both keep the required path to *what runs* and *what it is called*.

## Decision

Adding and editing a Project action, configuring Workspace setup or cleanup, and reviewing a shared preparation change all use **one guided panel**:

- **Docked right sidebar, not a modal.** It follows the workspace side panel's sizing (520px default, 320–900px, main area keeps 420px, width persisted, resizable from its left edge). At 980px or narrower it becomes a full-width sheet. Its content responds to the panel's own width. In Settings it docks beside the Project actions list.
- **It takes the single right-sidebar slot and gives it back.** Opening it replaces the current right sidebar. Closing it, by saving or cancelling, restores that sidebar. Other sidebars keep leaving the slot empty.
- **Two required questions, everything else optional.** "What should it run?" (a project script, recommended, or your own command) and "What should it be called?". Optional settings are rows that state their question and current answer in plain words and expand in place: whether it stops on its own, repeat clicks or browser preview, who has it, the folder, the keyboard shortcut and the icon. The icon is visual only and is picked from the script name. A one-line live summary above Save expands into a full sentence.
- **Plain wording everywhere users look.** "Keeps running until you stop it" and "Stops when it finishes" replace Service and Task in the panel, Settings, run views and user docs. Editing a shared action asks "Who should get these changes?" so that **Only me** clearly means a Local definition override.
- **A linked script shows its command as information.** A selected script stays a Project task reference; **Copy it as my own command instead** converts it explicitly. A script missing from the current workspace is explained, with **Keep it linked**, **Pick another script** or the last known command.
- **Unique names.** Project action names are unique per project, ignoring case. Suggestions are readable ("Start dev server", "Run tests") and name the package for package scripts. Existing duplicates keep working, are labelled apart, and are never renamed automatically.
- **Project action drafts are never lost silently.** A project has at most one draft, new or edit, kept privately on the device across leaving the panel and restarting. The + Action menu offers to continue it. A draft ends only on Save or an explicit discard. A draft whose saved action changed meanwhile lists the changes and offers **Keep my changes** or **Use the new version**; there is no silent overwrite.
- **After Save**, a confirmation offers an explicit **Run now** where a session exists. Saving still never runs anything.
- **Workspace preparation shares the panel.** Profiles stay hidden until a project has more than one. Reviewing a changed shared setup or cleanup is a panel mode with **Turn on this version** or **Keep it off**. It opens by itself only when worktree creation is waiting on it.
- **Saving a shared setup or cleanup turns it on for the person who saved it.** Saving counts as that user's review of exactly that version. Other users still review it before it runs for them, and later changes from others still need review.
- **Agent repair proposals are reviewed in the panel.** An agent's Command repair proposal arrives as structured data with **Review and save**, which opens the panel with the proposal as the draft.

## Consequences

The Add action, preparation editor and preparation review modals are removed. The right-sidebar coordinator gains restore-on-close for this panel only. Renderer storage gains private Project action drafts. Catalog saves reject a name that another action in the project already uses. The preparation save path records the saver's enablement atomically with the save. A new agent tool carries repair proposals. The user documentation for Project actions is rewritten around the new panel.
