---
name: write-docs
description: Write or edit OpenWaggle's user docs (website/src/content/docs) so they read like a person wrote them and still give agents exact facts. Use before adding, rewriting, or reviewing any docs page, screenshot, alt text, or docs table.
---

# Write OpenWaggle docs

The docs serve two readers. A person wants to finish a task. An agent, through the `openwaggle_docs` tool, wants an exact value. Both read the same pages, so write guides for the person and put exact lists in reference pages. [ADR 0061](../../../docs/adr/0061-user-docs-split-guides-reference-and-overview.md) records the decision; `website/src/lib/__tests__/docs-style.unit.test.ts` enforces the mechanical parts.

Apply `.agents/skills/unslop/SKILL.md` to everything you write. This skill adds the rules specific to OpenWaggle's docs.

## Pick the page kind

Every page sets `kind` in its frontmatter.

| Kind | What it is for | Shape |
| --- | --- | --- |
| `guide` | One task or feature | Opening paragraph that says what it is and when to use it. Task headings ("Start a Hive", "Stop a run"). Steps, short paragraphs, the values needed for the task. Links to reference pages. |
| `reference` | Exact facts to look up | One-line intro, then tables: name, type or values, default, what it does. No story. Section `Reference`, except pages in Developer docs and Package reference, which stay in their own sections. |
| `overview` | How parts fit together | Plain explanation of the model, for example projects, sessions, runs, the Session Host and Pi. One diagram at most. |

If a guide grows a table longer than 12 rows, or a list of every option, move it to a reference page and link to it. A fact lives in one place.

## Sentences

- Write to "you". Present tense. Active voice: "OpenWaggle stops the run", not "the run is stopped".
- One idea per sentence. If you have to reread it, split it.
- Do not join two sentences with a colon or a semicolon. Use a period. A colon is fine before a list or an example.
- Say what happens, with the real value: "MCP servers stop 5 minutes after the session's last run ends", not "servers are stopped after a period of inactivity".
- Lowercase ordinary nouns: session, run, worker, follow-up, steering, delegation, workspace, project, branch. Capitalize names: OpenWaggle, Pi, Hive, Queen, Waggle, Session Host.
- UI labels in **bold**, spelled and cased exactly as the app shows them. Check the string in `src/renderer`.
- Do not use specification words in guides and overviews: durable, atomically, lineage, authoritative, workspace binding, idempotent, "exact active Run". Say what they mean ("kept after the app restarts", "in one step", "the session it came from").
- No em dashes, no "Note that", no "It is important to", no "This allows you to".

Before and after, from the Hives guide:

> Atomically create and start a Worker beneath a parent, including its lineage and Delegation Contract. An optional title names it; without one it is titled from its objective.

> **Spawn** creates a worker under the current session and starts it on the task you give it. Give it a title, or OpenWaggle names it from the task.

## Screenshots

- Every image is captured by `scripts/capture-website-screenshots.ts`, never by hand, and listed in `scripts/website-screenshot-manifest.ts`. Read the website screenshot section of `MEMORY.md` first.
- An image appears on exactly one docs page. Another page that needs it links to that page.
- Crop to the feature the paragraph is about. Open the menu or show the state you are describing. Use at most one outline (the capture kit's highlight) on the control; never numbered badges.
- No captions under images. Put what the reader needs in the paragraph before the image.
- Alt text is one sentence, at most about 160 characters, saying what the image shows: "The composer's + menu open, with Add files and Add images." Do not inventory the screen.
- Screenshots use made-up fixture data: the `jotter` project or the OpenWaggle fixture project, the loopback fixture models, invented repositories and issue numbers. Never real accounts, paths or usage.

## Commands

Every code block gets a **Copy** button, so a reader pastes the whole block. Write each shell block so that pasting it does the right thing:

- One command per block, or commands meant to run together in that order. Alternatives ("run one of these") go in separate blocks with a sentence before each.
- No `$` or `>` prompts, no output, no `#` comments. Put the explanation in the sentence before the block.
- Keep each command on one line.
- Never type the install script's addresses. Write `{{install-command}}` for the whole command, `{{install-url}}` in a variant such as `curl -fsSL {{install-url}} | bash -s -- --no-launch`, and `{{install-script-raw-url}}` for the raw script. `website/src/lib/install-command.ts` defines them; the website, the bundled docs and the npm package READMEs fill them in, and `installer-url.unit.test.ts` rejects a typed address. In an `.mdx` page, put them only in code or inline code: MDX reads `{…}` in prose as a JavaScript expression.
- Write a placeholder the reader must change in uppercase, such as `SESSION_ID` or `RUN_ID`, and name it in the sentence before the block ("replace `SESSION_ID` with the session's ID"). Never use angle brackets such as `<session-id>` in a shell block, because the shell reads `<` as a redirect when the reader pastes it. `docs-style.unit.test.ts` rejects them. Angle brackets stay fine in syntax tables and prose.

## Tables

- Keep cells short. A cell that needs two sentences is a paragraph.
- Put the name column first and keep it to a word or two, so it never wraps mid-word.

## Before you finish

1. `bun run website:test` passes, including `docs-style.unit.test.ts`.
2. `bun run --filter @openwaggle/website build` passes and `bun run docs:generate` runs.
3. Every fact the page had before is still in the docs: in the guide, or in the reference page it links to. Check numbers, defaults, limits, exit codes and error behavior against the code, not memory.
4. Read the page out loud in your head. Anything that sounds like a specification or a chatbot gets rewritten.
