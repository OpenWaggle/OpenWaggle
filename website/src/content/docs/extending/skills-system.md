---
title: "Skills"
description: "Give the agent a reusable workflow with a SKILL.md file, then select it in a conversation."
order: 4
section: "Customize"
kind: "guide"
---

A skill is a set of written instructions for one kind of task, such as reviewing a change or writing a migration. It lives in a `SKILL.md` file. The agent sees each skill's name and description, and loads the full instructions when a task calls for them, or when you pick the skill yourself. Skills do not install tools or grant permissions.

Use [project instructions](/docs/extending/agents-md) for rules that apply across the whole project. Use a skill for a workflow the agent only needs some of the time.

## Create a skill

Make a folder for the skill in your project, named after it, with a `SKILL.md` inside:

```text
.openwaggle/skills/review-change/SKILL.md
```

Start the file with a name and a description of when to use it, then write the instructions:

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

Make the description specific. The agent reads it to decide whether the skill fits the task. Commit the folder with the project if you want other developers to use the same workflow.

### Frontmatter fields

Pi, the agent runtime inside OpenWaggle, reads the frontmatter. It acts on these fields:

| Field | Required | What it does |
| --- | --- | --- |
| `name` | Yes, for **Settings > Skills** | The skill's name and its `/skill:name` command. Use lowercase letters, digits, and single hyphens, up to 64 characters. |
| `description` | Yes | When the agent should use the skill, up to 1024 characters. |
| `disable-model-invocation` | No | `true` leaves the skill out of the agent's list. |

- A `name` or `description` that breaks the limits gets a warning from Pi, and the skill still loads.
- Without a `name`, Pi uses the folder name, but **Settings > Skills** reports the skill as an error.
- Without a `description`, Pi skips the skill.
- In the agent's list of skills, OpenWaggle shortens each description to about 160 characters, and keeps a "Use when…" sentence whole when it can.
- With `disable-model-invocation: true`, the agent never loads the skill by itself. Type `/skill:name` to use it.

The Agent Skills format also defines `license`, `compatibility`, `metadata`, and `allowed-tools`. Pi accepts a file that has them and ignores them, so `allowed-tools` does not approve any tool in advance.

## Use a skill in a message

Type `/` in the message box and pick the skill from the menu. Add the task you want it to do, then send. Your message keeps the skill reference, so you can see later which skill you used.

Pi also registers every loaded skill as a `/skill:name` command.

## Turn skills on or off for a project

Open **Settings > Skills** and choose the project in the header. Select a skill to preview its instructions, then turn it on or off for that project. The panel also shows whether the project has a root `AGENTS.md`.

![Settings > Skills with AGENTS.md marked Found, two skills switched on, and the review-change skill's instructions in the preview](/screenshots/settings-skills.png)

The project picker lists recent projects and projects with sessions, and can browse to another folder. Choosing a project here does not change the project selected beside the message box.

Turning a skill off removes it from the skills Pi gives the agent in that project. Other projects are not affected.

## Where skills come from

OpenWaggle looks for project skills in these folders, in this order. When two skills have the same name, the first folder wins:

```text
.openwaggle/skills/
.pi/skills/
.agents/skills/
```

[Override a skill for OpenWaggle only](/docs/configuration/per-project-config#resource-precedence) draws this order as a diagram. A few more sources add to it:

- Enabled OpenWaggle extension packages can add skill folders between `.openwaggle/skills/` and `.pi/skills/`.
- Pi also loads your user skills, the ones for every project, and `.agents/skills/` folders above the project.

**Settings > Skills** only scans `.openwaggle/skills/` and the project's root `.agents/skills/`, so it does not list every skill Pi can load. Its switches still reach the others. For skills in those two folders, a switch matches the skill's folder name. For every other skill Pi loads, it matches the skill's name. So turning off `review-change` in a project also turns off a user skill or a `.pi/skills/` skill named `review-change` there.

To configure skill folders beyond what Settings shows, see Pi's [customization reference](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md#customization).
