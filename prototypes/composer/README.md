# Composer prototypes

Throwaway HTML study for the OpenWaggle composer and first-send worktree flow. It has no React, Electron, IPC, or OpenWaggle runtime imports.

Run:

```bash
pnpm prototype:composer
```

Open the printed URL. Switch variants with the floating arrows, the keyboard left/right arrows, or direct URLs:

- `?variant=A` current direction
- `?variant=B` Single run target
- `?variant=C` Guided first run

Inspect the worktree-transition states without waiting for the animation:

- `?variant=A&demo=creating`
- `?variant=A&demo=checking`
- `?variant=A&demo=ready`

All three retain the Codex hierarchy: a preflight row above one large composer and a sparse lower toolbar. They differ only in how OpenWaggle presents `Current checkout` versus `New local worktree` and the worktree base branch.

## Current feedback applied to A

- Run location and base branch are independent top-level controls. The worktree menu no longer contains branch selection.
- The collapsed authorization label is `YOLO` or `Ask for approval`. The open menu explains `YOLO (Full Access)`.
- The plus menu exposes existing composer capabilities: attach text/image/PDF files, reference a project file, use a skill, and start Waggle. Drag-and-drop and automatic long-paste attachments remain secondary hints rather than menu actions.
- Type a prompt and press Enter in A to see the first-send transition. It follows the Codex component's state sequence: `Creating a worktree`, `Preparing workspace`, `Checking out files` with progress, then `Worktree created` and `Starting a task` before streaming. `More details` reveals operation output; `Work locally` and `Cancel` remain available while creation is in progress.

The controls only update browser memory. They do not create sessions, branches, or worktrees.
