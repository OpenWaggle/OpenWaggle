# Spec 17 — Shareable Skill Marketplace

**Goal**: Build an npm-like distribution system for agent behaviors. Developers create skills (review patterns, migration guides, framework conventions), publish them, and other developers install them with one command. OpenWaggle becomes a platform, not just a tool.

**Status**: Planned

**Depends on**: Existing skill system (`.openwaggle/skills/`, `SKILL.md`, `loadSkill` tool) — already implemented

---

## The Gap

| Platform | Format | Distribution | Install Experience | Versioning |
|----------|--------|-------------|-------------------|-----------|
| cursor.directory | Copy-paste text | Website | Manual copy-paste | None |
| Claude Code Skills | SKILL.md + directory | Git / file copy | Manual placement | None |
| Continue.dev | Config entries | Git | Manual editing | None |
| Windsurf | .windsurfrules | Git | Manual creation | None |
| MCP servers | Server implementations | npm / Docker | CLI config | semver |
| VSCode extensions | .vsix packages | Marketplace | One-click | semver |
| Vercel skills.sh | SKILL.md + GitHub | npx CLI | `npx skills add` | Git-based |
| SkillsMP | Aggregated from GitHub | Web catalog | Copy/clone | None |
| GPT Store (dead) | System prompts | Marketplace | One-click | None |

**The novel combination**: First desktop AI coding tool with a complete package management experience for agent behaviors — discovery, installation, versioning, updates, and quality signals.

### Key Ecosystem Context

- **Agent Skills standard** (agentskills.io) — Anthropic-originated, adopted by OpenAI, Google, Vercel, 30+ platforms. OpenWaggle's `.openwaggle/skills/` format is already aligned.
- **Vercel skills.sh** — First CLI package manager for skills, supports 40+ agents. Proves the install story works.
- **SkillsMP** — 270K+ skills indexed from GitHub. Proves supply exists.
- **GPT Store failure** — Prompt-only packages without tooling produce spam. Skills must bundle real capability.

---

## Architecture

### Skill Package Format

OpenWaggle already has this. Align with agentskills.io standard:

```
.openwaggle/skills/<skill-id>/
  SKILL.md            # Required: YAML frontmatter + instructions
  scripts/            # Optional: executable scripts (Python, Bash, Node)
  references/         # Optional: documentation loaded into context
  templates/          # Optional: code templates, config snippets
  examples/           # Optional: example conversations
  skill.json          # Optional: extended metadata (deps, compatibility)
```

**SKILL.md frontmatter:**
```yaml
---
name: security-audit
description: OWASP Top 10 scanning with structured reporting
version: 1.2.0
author: openwaggle-community
license: MIT
tags: [security, review, owasp]
compatibility: "openwaggle >= 0.2.0"
allowed-tools: [readFile, glob, grep]
---
```

### Distribution Channels

```
                    ┌──────────────────┐
                    │  GitHub Repos    │ ← primary source
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Skills Registry │ ← JSON catalog (GitHub Pages)
                    │  (openwaggle/   │
                    │   skills-registry)│
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        CLI install     In-App Browser   Web Catalog
        (Phase 1)       (Phase 3)        (Phase 4)
```

---

## Implementation

### Phase 1: CLI Installation from GitHub

- [ ] Add skill management commands to OpenWaggle
  - In-app command: `/skill install github:user/repo/skill-name`
  - In-app command: `/skill list` — show installed skills
  - In-app command: `/skill remove <skill-id>` — uninstall
  - In-app command: `/skill update <skill-id>` — pull latest
  - In-app command: `/skill update --all` — update all
- [ ] Create `src/main/skills/installer.ts`
  - `installSkill(source: string)` — parse source, download, validate, install
  - Source formats:
    - `github:user/repo` — whole repo is one skill
    - `github:user/repo/path/to/skill` — skill in subdirectory
    - `github:user/repo#tag` — specific version
  - Download via GitHub API (tarball) or git clone (sparse checkout)
  - Validate: SKILL.md exists, frontmatter has required fields
  - Install to `.openwaggle/skills/<skill-id>/`
- [ ] Create `.openwaggle/skills.lock` manifest
  ```json
  {
    "skills": {
      "security-audit": {
        "source": "github:openwaggle-community/skills/security-audit",
        "version": "1.2.0",
        "installedAt": "2026-02-24T10:00:00Z",
        "checksum": "sha256:abc123..."
      }
    }
  }
  ```
  - Enables reproducible installs across team members
  - Committed to git for team-shared skills

### Phase 2: Skills Registry

- [ ] Create registry repo: `openwaggle/skills-registry`
  - `registry.json`: flat catalog of skills with metadata
  ```json
  {
    "skills": [
      {
        "id": "security-audit",
        "name": "Security Audit",
        "description": "OWASP Top 10 scanning with structured reporting",
        "source": "github:openwaggle-community/skills/security-audit",
        "version": "1.2.0",
        "author": "openwaggle-community",
        "tags": ["security", "review", "owasp"],
        "downloads": 1240,
        "stars": 45
      }
    ]
  }
  ```
  - Hosted on GitHub Pages (free, fast, global CDN)
  - Updated via PR: submit your skill, CI validates, maintainer merges
- [ ] Add search command: `/skill search "security audit"`
  - Fetches registry, filters by name/description/tags
  - Shows results with install commands
- [ ] Add browse command: `/skill browse --tag=testing`

### Phase 3: In-App Skills Panel

- [ ] Skills management UI in settings
  - Tab: "Installed Skills"
    - List with enable/disable toggles
    - Version, author, source link
    - Update available indicator
    - Uninstall button
  - Tab: "Browse Skills"
    - Search bar + tag filter
    - Skill cards with name, description, author, downloads, stars
    - One-click install button
    - Preview: show SKILL.md content before installing
- [ ] Skill detail view
  - Full description from SKILL.md
  - Allowed tools (security transparency)
  - Compatibility info
  - Install/uninstall action

### Phase 4: Web Catalog (future)

- [ ] Website at `openwaggle.ai/skills` (or standalone)
  - Browse, search, filter by category
  - Skill detail pages with README, install instructions
  - Usage statistics, star ratings
  - "Submit Your Skill" flow

### Phase 5: Skill Creation Workflow

- [ ] `/skill create <name>` scaffolding command
  - Creates `.openwaggle/skills/<name>/SKILL.md` with template frontmatter
  - Creates optional directories (scripts/, references/, examples/)
- [ ] Skill testing: `/skill test <name>`
  - Validates SKILL.md format
  - Dry-run: loads skill and checks tool declarations
  - Example conversation replay (if examples/ provided)
- [ ] Publishing guide in docs
  - How to structure a skill
  - How to submit to registry
  - Best practices (tested examples, clear descriptions, version bumps)

---

## Security Model

Skills can define tools that execute code. This requires careful security:

1. **Approval inheritance**: Skills with `scripts/` trigger the existing `needsApproval` flow for any tool calls. No silent script execution.
2. **Tool whitelist**: `allowed-tools` in frontmatter declares what tools the skill can use. Runtime enforces this as a whitelist.
3. **Provenance tracking**: `skills.lock` records source, version, checksum. Alert if installed files are modified locally.
4. **Zero-trust default**: Community skills are untrusted by default. Verified publishers (GitHub verified orgs) get a trust indicator but still require approval for destructive operations.
5. **Prompt injection defense**: Skills load in a clearly delineated context section. The agent runtime frames skill instructions separately from user input.
6. **No network access from skill scripts**: Scripts can read/write local files but cannot make network requests (sandboxed execution).

---

## Seed Skills (Launch Content)

Start with 10-15 high-quality curated skills:

| Skill | Description | Priority |
|-------|------------|----------|
| `code-review` | Structured review with configurable criteria | P0 |
| `test-writer` | Generate tests following project conventions | P0 |
| `zod-v4` | Zod v3→v4 migration patterns (already exists) | P0 (done) |
| `react-19` | React 19 idioms, no forwardRef, no memo | P0 |
| `nextjs-app-router` | App Router patterns, server components | P1 |
| `tailwind-v4` | Tailwind v4 patterns, OKLCH colors | P1 |
| `security-audit` | OWASP Top 10 scanning | P1 |
| `docs-generator` | TSDoc/JSDoc generation following conventions | P1 |
| `perf-audit` | React re-render detection, bundle analysis | P2 |
| `docker-setup` | Containerization for Node.js apps | P2 |
| `ci-github-actions` | GitHub Actions workflow generation | P2 |
| `adr-writer` | Architecture Decision Records | P2 |

---

## Network Effects Strategy

1. **Low friction contribution**: Create a SKILL.md, submit a PR to the registry repo. No build step, no accounts, no packaging tools.
2. **Cross-platform reach**: Skills built for OpenWaggle work in Claude Code, Codex, Copilot (Agent Skills standard). Authors reach more users → more motivation to contribute.
3. **Quality over quantity**: Curate initial catalog. Require minimum quality (tested examples, clear description). Avoid GPT Store spam problem.
4. **Attribution**: Author name, GitHub link, download counts. Developers contribute when they get credit.
5. **Enterprise adoption**: Teams create internal skills, open-source the non-proprietary ones.

---

## Files to Create

- `src/main/skills/installer.ts` — skill download, validate, install
- `src/main/skills/registry.ts` — registry fetch, search, cache
- `src/main/skills/manifest.ts` — skills.lock read/write
- `src/renderer/src/components/settings/SkillsPanel.tsx` — in-app skill management
- `src/renderer/src/components/settings/SkillBrowser.tsx` — browse/search UI

## Files to Modify

- `src/main/ipc/` — IPC handlers for skill install/remove/update/search
- `src/shared/types/ipc.ts` — skill management IPC channels
- `src/renderer/src/components/settings/` — add skills tab

---

## Verification

- [ ] `/skill install github:openwaggle-community/skills/security-audit` downloads and installs
- [ ] Installed skill appears in `/skill list` and is loadable by agent
- [ ] `skills.lock` correctly tracks installed skills with checksums
- [ ] `/skill search "security"` returns results from registry
- [ ] In-app skills panel shows installed skills with enable/disable
- [ ] Skill update detects newer version and applies it
- [ ] Skill with `scripts/` triggers approval flow (security)
- [ ] `allowed-tools` whitelist is enforced at runtime
- [ ] Skill removal cleanly deletes directory and updates manifest
