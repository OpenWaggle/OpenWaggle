# 33 — Shareable Skill Marketplace

**Status:** Planned
**Priority:** P4
**Category:** Feature
**Depends on:** Existing skill system (already implemented)
**Origin:** Spec 17

---

## Goal

Build an npm-like distribution system for agent behaviors. Developers create skills, publish them, and others install with one command. OpenWaggle becomes a platform, not just a tool.

## Architecture

### Distribution Channels

```
GitHub Repos ← primary source
     │
Skills Registry (GitHub Pages JSON catalog)
     │
  ┌──┼──┐
  CLI  In-App  Web Catalog
```

## Implementation

### Phase 1: CLI Installation from GitHub
- [ ] `/skill install github:user/repo/skill-name`
- [ ] `/skill list`, `/skill remove`, `/skill update`
- [ ] `src/main/skills/installer.ts` — download, validate, install
- [ ] `.openwaggle/skills.lock` manifest for reproducible installs

### Phase 2: Skills Registry
- [ ] `openwaggle/skills-registry` repo with `registry.json`
- [ ] `/skill search "security audit"` — fetch and filter
- [ ] Hosted on GitHub Pages

### Phase 3: In-App Skills Panel
- [ ] "Installed Skills" tab: list, enable/disable, update, uninstall
- [ ] "Browse Skills" tab: search, install, preview

### Phase 4: Web Catalog (future)
- [ ] `openwaggle.ai/skills` — browse, search, submit

### Phase 5: Skill Creation Workflow
- [ ] `/skill create <name>` scaffolding
- [ ] `/skill test <name>` validation + dry-run

## Security Model

1. **Approval inheritance**: Skills with scripts trigger `needsApproval`
2. **Tool whitelist**: `allowed-tools` in frontmatter, runtime enforced
3. **Provenance tracking**: `skills.lock` records source, version, checksum
4. **Zero-trust default**: Community skills untrusted by default
5. **No network access**: Scripts sandboxed from network

## Files to Create

- `src/main/skills/installer.ts`
- `src/main/skills/registry.ts`
- `src/main/skills/manifest.ts`
- `src/renderer/src/components/settings/SkillBrowser.tsx`

## Files to Modify

- `src/main/ipc/` — skill management IPC handlers
- `src/shared/types/ipc.ts` — skill channels
- `src/renderer/src/components/settings/` — skills tab
