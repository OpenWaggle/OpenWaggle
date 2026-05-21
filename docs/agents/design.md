# Agent Design Context

This file is for agent-facing product and UI decisions. User-facing documentation stays under `website/src/content/docs/`.

## Product Direction

OpenWaggle is a local-first desktop coding workspace over Pi. Design should make runtime truth visible instead of hiding it behind synthetic UI state.

Core product principles:

- The user remains in control through visible session, branch, tool, model, and run state.
- Pi-native runtime behavior should be represented faithfully.
- Waggle mode should feel like collaborative problem-solving over the same session model, not a separate chat product.
- Project-local configuration should be explicit and inspectable.

## UI Surfaces

Important surfaces:

- Chat transcript and tool timeline.
- Composer, branch-scoped config, attachments, voice input, slash commands, and compaction.
- Session Tree, branch lifecycle, branch summaries, and navigation.
- Settings for providers, models, auth, MCP, app preferences, and data.
- Diff, git status, commit flow, and built-in terminal.
- Waggle preset and collaboration controls.

## Design Rules For Agents

- Preserve existing visual language unless the task explicitly asks for redesign.
- Keep agent/tool/runtime state truthful and inspectable.
- Prefer in-context controls over modal flows unless the task needs focused decision-making.
- Do not duplicate user-facing docs in `docs/agents/`; link to `website/src/content/docs/`.
- For renderer changes, follow `.agents/standards.md` and validate with `.agents/verification.md`.
- For high-impact UI changes, use `frontend-design` or `interface-design` only when the task asks for design work or a new interface.

## References

- `docs/first-principles.md`
- `docs/renderer-architecture.md`
- `docs/specs/waggle-composer-wireframes.md`
- `website/src/content/docs/using-openwaggle/`
- `website/src/content/docs/configuration/`
- `website/src/content/docs/developer-workflow/`
