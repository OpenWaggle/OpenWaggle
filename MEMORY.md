# MEMORY.md

Durable OpenWaggle project memory. Keep this compact and technical. Do not add personal/cross-repo agent preferences here.

This file is an index. Read it, then load only the topic files under `.agents/memory/` whose
trigger matches the task. Each topic file opens with a summary of what it covers and when to
load it. Do not load every topic.

## Topics

Each line names a topic file and when to load it:

- [`architecture-and-conventions`](.agents/memory/architecture-and-conventions.md): before any non-trivial change: process boundaries, where Pi SDK imports live, dirty-tree rule.
- [`pi-runtime`](.agents/memory/pi-runtime.md): touching `src/main/adapters/pi/`, `packages/pi-*`, Pi upgrades, Pi extensions, Pi session files or tool schemas.
- [`compaction`](.agents/memory/compaction.md): touching compaction (automatic, manual `/compact`, native checkpoints) or the context meter.
- [`providers-and-models`](.agents/memory/providers-and-models.md): touching provider auth, model selection, thinking levels or provider credentials.
- [`mcp`](.agents/memory/mcp.md): touching `src/main/adapters/mcp/`, MCP config, OAuth, approval or the MCP pool.
- [`session-host`](.agents/memory/session-host.md): touching `src/main/session-host/`, the Local Session protocol, Host database, connections or Host performance.
- [`sessions`](.agents/memory/sessions.md): touching Session Control, Follow-ups, steering, Run lifecycle, fork/clone, titles or notifications.
- [`session-search-and-discovery`](.agents/memory/session-search-and-discovery.md): touching Session search, FTS/semantic discovery, archived-items search or Pi session discovery.
- [`hive`](.agents/memory/hive.md): touching the `hive` tool, Workers, Delegations, Agent definitions, Hive wake or the Hive panel.
- [`scheduled-tasks`](.agents/memory/scheduled-tasks.md): touching Heartbeats, Launch schedules or `openwaggle schedules`.
- [`access-and-authorization`](.agents/memory/access-and-authorization.md): touching authorization modes, grants, approvals, caller ceilings or catalog-wide reach.
- [`cli`](.agents/memory/cli.md): touching the `openwaggle` CLI, CLI profiles and credentials, or CLI exit and error kinds.
- [`renderer-transcript`](.agents/memory/renderer-transcript.md): touching `features/chat` transcript rows, scrolling, streaming render or edit/fork points.
- [`renderer`](.agents/memory/renderer.md): touching `src/renderer/src/` outside the transcript: composer, sidebar, Summary, focus, shortcuts, React Compiler.
- [`workspace-files-and-syntax`](.agents/memory/workspace-files-and-syntax.md): touching the file panel, Focused file edit, Pierre diffs, Shiki/syntax workers or themes.
- [`git-and-worktrees`](.agents/memory/git-and-worktrees.md): touching Git operations, managed worktrees, worktree removal, source control or change requests.
- [`project-actions`](.agents/memory/project-actions.md): touching Project Actions, Setup/cleanup preparation, action bindings or action output.
- [`terminals-and-browser-preview`](.agents/memory/terminals-and-browser-preview.md): touching Session-bound terminals, node-pty/xterm, or the Session-owned Browser preview.
- [`session-resources`](.agents/memory/session-resources.md): touching Session resources, captured images, the resource protocol or extension resource contributions.
- [`electron-shell`](.agents/memory/electron-shell.md): touching Electron main-process startup, the desktop shell ports and Electron adapters, packaging, native addons, hidden QA, visualizations or `bun run dev:debug`.
- [`electrobun-native-layer`](.agents/memory/electrobun-native-layer.md): touching `vendor/electrobun/`, the Electrobun floor guards, `electrobun-native.yml`, or the Electrobun CEF preview and CDP.
- [`persistence-and-migrations`](.agents/memory/persistence-and-migrations.md): adding a migration or touching SQLite schemas, settings keys or `src/main/services/database-*`.
- [`release-and-ci`](.agents/memory/release-and-ci.md): touching `.github/workflows/`, release scripts, signing, updater artifacts or the commit policy.
- [`tooling`](.agents/memory/tooling.md): touching lint, format, TypeScript config, dependencies, repository standards or scripts.
- [`testing`](.agents/memory/testing.md): writing or debugging tests: tiers, timeouts, fixtures, temp files, component tests.
- [`performance`](.agents/memory/performance.md): measuring or budgeting performance: first-turn prefix, startup, benchmarks, probes.
- [`website-and-docs`](.agents/memory/website-and-docs.md): touching `website/`, docs routing, screenshots, diagrams, schemas or SEO.
- [`telemetry`](.agents/memory/telemetry.md): touching usage statistics, Sentry error reports, provider attribution or Usage & Cost.
- [`product-and-ux`](.agents/memory/product-and-ux.md): making product or UX decisions: Summary default, Projects-only sidebar, naming Pi, Waggle scope.
- [`archive`](.agents/memory/archive.md): never by default; only for history of removed code paths.

## Adding memory

- Add a finding to the topic file it belongs to, under a heading that names it. Do not add
  findings to this index.
- Add a topic only when no existing one fits: create `.agents/memory/<topic>.md` with a
  title and a 3-6 line summary (what it covers, when to load it), and add one line here.
- When an entry describes code that has been removed, move it to `archive.md` instead of
  deleting it.
- `bun run check:repository-standards` caps this index at 2,000 o200k tokens and each topic file
  at 12,000. Split a topic that reaches its cap instead of trimming facts.
