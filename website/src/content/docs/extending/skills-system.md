---
title: "Skills System"
description: "Current skill discovery surfaces and Pi-native runtime loading."
order: 1
section: "Extending"
---

Skills are instruction packages with a `SKILL.md` file.

Pi references: [coding-agent customization](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md#customization) and [extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md).

## Runtime Source Of Truth

Pi's runtime resource loader is the source of truth for skills that affect agent runs. Current Pi discovery includes project `.pi/skills/` and `.agents/skills/` locations, plus user/global Pi resource locations.

OpenWaggle also adds `.openwaggle/skills/` to Pi's skill loader. The Skills panel scans `.openwaggle/skills/` and `.agents/skills/`, shows metadata, previews instructions, and persists per-project enable/disable toggles for the OpenWaggle catalog.

Catalog toggles are applied to `.openwaggle/skills/` and root `.agents/skills/` before Pi builds runtime context. `.pi/skills/`, ancestor `.agents/skills/`, and global/user Pi resources remain governed by Pi discovery.

## Skills Panel

Open the Skills panel from the sidebar. It shows:

- Root `AGENTS.md` status.
- Cataloged skills.
- Enable/disable toggles.
- A preview pane for the selected `SKILL.md`.

## Slash References

Type `/` in the composer to open the command palette and insert a skill reference into the message.

Slash references stay visible in the message text. Pi also registers loaded skills as `/skill:name` commands according to its own resource-loader behavior.

## Recommended Runtime Folder

For skills that should be loaded by Pi today, use:

```text
.openwaggle/skills/my-skill/SKILL.md
.pi/skills/my-skill/SKILL.md
.agents/skills/my-skill/SKILL.md
```

## SKILL.md Format

```markdown
---
name: My Custom Skill
description: A brief description of what this skill does
---

# My Custom Skill

## Instructions

Describe the workflow, constraints, or patterns the agent should use.
```
