---
name: setup-matt-pocock-skills
description: Set up the repo context expected by Matt Pocock engineering skills using AGENTS.md, .agents/, and docs/agents/. Run before first use of to-issues, to-prd, triage, diagnose, tdd, improve-codebase-architecture, or zoom-out when issue tracker, triage labels, or domain docs are not configured.
disable-model-invocation: true
---

# Setup Matt Pocock Skills

Set up the repository context that the Matt Pocock engineering skills expect, without coupling to a specific coding agent vendor.

This skill is prompt-driven. Explore first, present findings, confirm decisions, then edit.

## Outputs

Create or update these files only when this setup skill is intentionally run:

```text
docs/agents/domain.md
docs/agents/issue-tracker.md
docs/agents/triage-labels.md
docs/agents/design.md
docs/agents/release.md
```

Update the `## Agent skills` block in `AGENTS.md` if needed.

## Process

### 1. Explore

Inspect the repository before asking questions:

- `git remote -v` and `.git/config` for issue tracker hints.
- `AGENTS.md` for an existing `## Agent skills` block.
- `.agents/standards.md` and `.agents/verification.md` for current operating rules.
- Existing architecture/product docs such as `docs/first-principles.md`, `docs/system-architecture.md`, `docs/hexagonal-architecture.md`, and `docs/specs/`.
- Existing `docs/agents/` files, if any.
- Existing GitHub/GitLab labels or local issue conventions, if discoverable.

### 2. Decide One Topic At A Time

Ask only unresolved questions. If the repo answers the question, use the repo answer.

Issue tracker:

- GitHub Issues
- GitLab Issues
- Local markdown
- Other tracker described by the maintainer

Triage label vocabulary:

- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`

Domain docs:

- Single-context repo
- Multi-context repo with a map

Additional OpenWaggle context files:

- `design.md` for agent-facing design/product conventions.
- `release.md` for agent-facing release/update-track conventions.

### 3. Draft

Show the user the proposed `AGENTS.md` block and the planned `docs/agents/*.md` files before writing.

The `AGENTS.md` block should look like this:

```markdown
## Agent skills

### Issue tracker

[summary]. See `docs/agents/issue-tracker.md`.

### Triage labels

[summary]. See `docs/agents/triage-labels.md`.

### Domain docs

[summary]. See `docs/agents/domain.md`.
```

### 4. Write

- Create `docs/agents/` if missing.
- Update an existing `## Agent skills` block in `AGENTS.md` in place.
- Do not duplicate architecture docs. Point to existing docs instead.
- Do not run broad code validation unless setup edits include scripts/config beyond Markdown.

### 5. Report

State which files were created or updated and which Matt skills now have the context they need.
