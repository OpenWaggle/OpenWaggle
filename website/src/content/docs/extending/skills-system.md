---
title: "Skills"
description: "Give the agent a reusable workflow with a SKILL.md file, then select it in a conversation."
order: 4
section: "Customize"
---

A skill is a set of instructions for a particular task, such as reviewing a change or writing a migration. It lives in a `SKILL.md` file. Skills do not install new tools or grant permissions.

Use [project instructions](/docs/extending/agents-md) for rules that apply throughout the project. Use a skill for a workflow you want the agent to load when needed.

## Recommended runtime folder

Create a directory in your project for the skill:

```text
.openwaggle/skills/review-change/SKILL.md
```

You can commit this file with the project so other developers can use the same workflow.

## SKILL.md format

Start with a name, a description of when to use it, and concrete instructions:

```markdown
---
name: review-change
description: Review a Git diff for bugs, regressions, and missing tests.
---

# Review a change

Read the diff and the affected callers before drawing conclusions.
Report concrete defects with file and line references.
Do not edit files unless asked. State which checks you ran and which you did not.
```

Keep the description specific. It helps the agent decide when the skill applies.

## Skills panel

Open **Settings > Skills** and choose the project in the header. Select a skill to preview its instructions, then enable or disable it for that project. The panel also shows the root `AGENTS.md` status.

The project picker can browse recent projects, projects with sessions, or another folder. Browsing does not change the project selected beside the message box.

## Slash references

Type `/` in the message box and select a skill from the menu. Add the task you want it to perform, then send the message. The skill reference remains visible in your message.

Pi, the agent runtime used by OpenWaggle, also registers loaded skills as `/skill:name` commands according to its resource-loading behavior.

## Runtime source of truth

OpenWaggle loads project resources in this order. For skills with the same name, the first location wins:

```text
.openwaggle/skills/
.pi/skills/
.agents/skills/
```

Enabled OpenWaggle extension packages can add skill resource roots between `.openwaggle/skills/` and `.pi/skills/`. Pi also discovers user/global skills. The Settings catalog scans `.openwaggle/skills/` and root `.agents/skills/`, so it is not a complete inventory of every skill Pi can load.

Catalog toggles filter loaded skills before Pi builds the agent's context. For the two catalog roots, the toggle key is the normalized skill directory name. For other Pi-loaded skills, including global/user, `.pi/skills/`, and ancestor `.agents/skills/` resources, it is the normalized skill name. An explicit disabled toggle therefore also excludes a matching skill from those sources in that project without changing other projects. Pi still controls discovery outside the catalog.

For resource configuration beyond the Settings catalog, see Pi's [customization reference](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md#customization).
