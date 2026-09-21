# Project Actions UI study

Throwaway prototype for reviewing the flow from the Session Hub to action output, project settings, and action creation. The initial A/B/C layouts were rejected. This revision follows the maintainer's requested layout.

Run `pnpm --config.verify-deps-before-run=false prototype:actions`, then open <http://127.0.0.1:4318/>. Old links with `?variant=B` also show the replacement. The flag avoids pnpm 11 installing the whole Electron workspace before running this dependency-free study.

`session-hub.html` is the editable, self-contained fragment. `index.html` is its generated standalone preview, including the visualization runtime and icons. The same fragment is delivered directly in the conversation so a phone does not need access to the Mac's localhost server. To regenerate the standalone preview, use `scripts/render.py` from the installed `visualize` skill with this fragment, `index.html` as the destination, and `--force`.

## What to review

- **Session Hub:** running and recent actions appear with the existing Environment and Changes sections. Selecting an action opens the right sidebar on desktop and a full-width detail view on a phone.
- **Run details:** output, Stop, Restart, Preview, copy controls, run metadata, and a failure-to-agent draft. Selecting an active action from the launcher opens its current run. Restart replaces it explicitly; stopping retains its output.
- **Settings:** saved task references, names, ownership and execution preferences. The running summary links back to the hub. Setup and cleanup have a separate preparation tab.
- **Add action:** choose a discovered root/package task, then name it and choose storage. Custom commands remain available. Saving does not start a process, and storage defaults to Only you for this project.

The main audience is a developer checking a running command while working with an agent. The hub gives status without becoming a command editor; the sidebar gives enough space to act on a run; Settings owns the definitions. The app's system fonts, charcoal surfaces, amber selection, and semantic green/red signals carry into this study, with corresponding light-theme colors.

The prototype supports touch targets and container-based layouts down to 320px. On narrow screens, dialogs replace the visible app content instead of squeezing a desktop modal over it. The conversation remains accessible when the hub is closed. All flows use the same simulated state.

No commands execute. Nothing is written to user configuration or project settings. Refresh resets the study. Discovery is a fixed fixture, preview is simulated, and setup/cleanup are limited to illustrating their settings and review placement. It does not implement process supervision, workspace isolation, shared overrides, or backend discovery. Production implementation remains pending.

The maintainer accepted this layout direction on 2026-09-21. ADR 0034 records the decision. Rebuild the accepted interaction with the production design system; this throwaway code is a reference. Implementation and runtime validation remain pending.

## Verification of this revision

Browser checks covered 320 × 740, 390 × 844, 1024 × 900, and 1440 × 1000 viewports, with light and dark appearances. The hub, sidebar, settings, preview and both creation steps fit without horizontal overflow. Exercised Stop with retained output, explicit Restart, reuse of an active run, package-task filtering, default local storage, custom shared definitions, cleanup review, a failure-to-agent draft, modal Escape/focus return, and the clipboard fallback used in the sandboxed preview. The final browser console was clear. The server passes a standalone strict TypeScript check and the fragment script parses successfully. No production renderer files changed; Electron QA and runtime behavior are outside this study.
