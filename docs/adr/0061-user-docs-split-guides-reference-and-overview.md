---
status: accepted
---

# User docs split guides, reference and overview pages, and read as plain English

Date: 2026-11-05

The user docs under `website/src/content/docs/` had become hard to read. Guides carried full specifications: the Hives guide listed every `hive` action with its queue and authorization rules, and the composer screenshot with eight numbered badges appeared on six pages, each with a caption such as "**+** is number 3". The text copied the glossary's capitals (Session, Run, Worker, Follow-up) and its specification words (durable, atomically, lineage), so it read like a protocol document written by an agent.

The same pages are also what agents read. `pnpm docs:generate` bundles them into the app, and the `openwaggle_docs` tool lists, searches and reads them. So the docs have to serve a person learning a task and an agent looking up an exact value. Pi's own docs do both by keeping three kinds of page apart, and this decision, made with the maintainer, adopts the same split as a permanent rule.

## Decisions

- **Every docs page has a `kind` in its frontmatter: `guide`, `reference` or `overview`.** The content schema rejects a page without one.
  - A **guide** teaches one task. Its title names the task or feature, its first paragraph says in plain words what the feature is and when to use it, and its headings are things you do. It keeps the values a reader needs to do the task (a default, a limit, what happens on failure) and links to reference pages for the rest.
  - A **reference** page lists exact facts in tables: settings, file formats, commands, exit codes, environment variables, shortcuts, states. It has no narrative, and it lives in the **Reference** section of the sidebar.
  - Pages in the **Developer docs** and **Package reference** sections may be reference pages outside the **Reference** sidebar section, such as the Hive CLI, Command line and Extension manifest pages. The docs-style test already exempts them.
  - An **overview** explains how the parts fit together (for example **How OpenWaggle works**), so guides do not each explain it again.
- **A fact lives in one place.** When a guide needs a full list, the list lives on a reference page and the guide links to it.
- **Existing page URLs and topic IDs stay.** A page that moves gets a redirect in `website/astro.config.ts` and `website/public/_redirects`, so old links and the topic IDs agents remember keep working.
- **Plain English, in the user's terms.** Ordinary nouns are lowercase in user docs: session, run, worker, follow-up, steering, delegation, workspace, project, branch. Names keep their capitals: OpenWaggle, Pi, Hive, Queen, Waggle, Session Host. UI labels are **bold** and spelled exactly as the app shows them. Specification words (durable, atomically, lineage, authoritative, workspace binding) are replaced with what they mean. Code, issues, `CONTEXT.md` and agent-facing text keep the glossary's casing.
- **Screenshots show one thing.** Each screenshot appears on exactly one docs page. It is cropped to the feature the text is about, with at most one outline around the control, and no numbered badges. There are no captions under images: what the reader needs goes in the paragraph. Alt text is one short sentence that says what the image shows.
- **Text written for models is out of scope.** Tool descriptions, the `hive` tool's help, and run-context prompts are tuned for models and checked by agent-context evaluations. They change only with their own review.

## Consequences

- `website/src/lib/__tests__/docs-style.unit.test.ts` enforces the page kinds, the guide shape, the image rules and a short list of banned words in guides, in the per-PR unit tier. A page that genuinely needs a banned word allows it in a comment at the top of the file (`<!-- docs-style allow: durable -->`), so each exception shows up in review.
- `.agents/skills/write-docs/SKILL.md` is the writing guide, and `AGENTS.md` tells agents to load it before editing the docs.
- A rewrite can lose a fact an agent relied on, such as an exit code or a timeout. Docs reviews check that every fact a page had is still somewhere, not only that the page reads well.
