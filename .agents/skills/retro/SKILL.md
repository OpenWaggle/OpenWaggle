---
name: retro
description: Retrospective of a coding session, ending in edits to skills, memory and standards. Use on /retro, after a long or rough session, or to ask what cost time.
---

# Retro

Look back at one coding session and turn what happened into edits that make the next session cheaper. A finding that ends in "be more careful next time" changes nothing. Each finding either ends in a proposed edit to a file or goes on the "not changing" list with the reason.

## 1. Gather evidence

Work from the record, not from memory of how it felt.

- The session transcript. For Hive work, also the Workers' transcripts (`hive` `read` or `turns`) and their Delegation reviews.
- The branch: `git log --oneline origin/main..HEAD`, `git diff --stat origin/main...HEAD`, reverted or rewritten commits.
- What failed and how often: checks that went red, the same command run more than twice, tests re-run after a timeout, edits undone later.
- Where time went: long waits on commands, files read and then not used, questions the user had to answer, detours that were dropped.

Cite each point: a command, a turn, a file, a check name. Leave out anything you cannot point to.

## 2. Sort the findings

- **Went well.** Note it only when a skill, memory entry or check caused it. That is evidence the pointer works and should stay as worded.
- **Cost time.** Say how much (minutes, retries, failed runs) and name the cause:
  - missing knowledge, and where an agent would have looked for it;
  - a pointer that did not fire: the material existed, but the skill description or `MEMORY.md` line did not match the task's words;
  - a tool, check or type that fought the change. Treat it as information about the design (System Resistance in `.agents/standards.md`), not as an obstacle to route around;
  - a slow feedback loop: the command, how long it took, and the faster one that would have answered;
  - the environment: machine load, network, flaky test. Name the test.

## 3. Decide where each fix belongs

| What the session lacked | Where the fix goes |
| --- | --- |
| A fact about this codebase a later agent will need | The matching `.agents/memory/<topic>.md`, under a heading that names the finding. A new topic only when none fits, with one line added to `MEMORY.md`. |
| A pointer that existed but did not fire | Reword the skill `description` or the `MEMORY.md` line, following `.agents/skills/write-a-skill/SKILL.md` ("Descriptions are context pointers"). |
| A procedure that will repeat | A skill under `.agents/skills/<id>/`. A vendored skill's edit is recorded with `bun scripts/skills-lock.ts record <id> --reason "<why>"`. |
| A rule every change must follow | `.agents/standards.md`, with a mechanical check (a repository-standards rule in `scripts/standards/` or a lint rule in `scripts/oxlint/`) whenever one is practical. |
| Which check to run for which change | `.agents/verification.md`. |
| A product, architecture or process decision | An ADR, through `.agents/skills/grill-with-docs/SKILL.md`. |
| A bug in code, tooling or a check | A fix or an issue, not prose. |

Prefer a check over a sentence, and editing an existing line over adding a new one. A topic file that would pass its cap (12,000 o200k tokens; 2,000 for `MEMORY.md`) is split, not trimmed.

## 4. Propose concrete edits

For each edit give the file, the exact text to add, replace or remove, the finding it answers, and its cost. Text that every turn loads (`AGENTS.md`, skill descriptions, the `MEMORY.md` index) is priced with `bun run tokens:count`. Text behind a pointer costs only when it is read.

Propose three to seven edits. If there are more, keep the ones that would have saved the most time.

## Output

```markdown
## Retro: <branch or task>

### Went well
- <what>, because <skill, memory entry or check> (<evidence>)

### Cost time
- <what>: <minutes, retries or failed runs>. Cause: <cause>. Evidence: <command, turn or file>

### Proposed edits
1. `<path>`: <add | replace | remove>
   <exact text, or a before/after pair>
   Answers: <finding>. Cost: <+N o200k every turn | on demand>

### Not changing
- <finding>: <why no edit>
```

Do not apply the edits unless the user asks. Project memory holds technical findings about OpenWaggle only, never personal or cross-repository preferences.
