# Agent Triage Labels

Use these canonical Matt-style triage roles on GitHub Issues.

## Category Labels

Every triaged issue should have exactly one category label:

| Role | GitHub label | Meaning |
|---|---|---|
| Bug | `bug` | Something is broken. |
| Enhancement | `enhancement` | New feature, improvement, or product change. |

The repository also has `feature`; prefer `enhancement` for triage state-machine consistency unless the maintainer explicitly asks for `feature`.

## State Labels

Every triaged issue should have exactly one state label:

| Role | GitHub label | Meaning |
|---|---|---|
| Needs triage | `needs-triage` | Maintainer or agent has not fully evaluated the issue yet. |
| Needs info | `needs-info` | Waiting on reporter or maintainer for specific missing information. |
| Ready for agent | `ready-for-agent` | Fully specified and suitable for an AFK coding agent. |
| Ready for human | `ready-for-human` | Valid work, but needs human judgment, external access, design approval, or manual release/distribution action. |
| Wontfix | `wontfix` | Will not be actioned. Close the issue with a clear explanation. |

Do not use `question` as the canonical needs-info state. It can remain for general support, but triage should use `needs-info`.

## Priority Labels

Use priority labels only when priority is clear:

| Label | Meaning |
|---|---|
| `P1` | Critical priority. |
| `P2` | High priority. |
| `P3` | Medium priority. |
| `P4` | Low priority. |

## Area Labels

Use area labels to route work. Existing examples include:

- `agent`
- `composer`
- `documentation`
- `git-integration`
- `infrastructure`
- `performance`
- `persistence`
- `refactor`
- `reliability`
- `renderer`
- `skills`
- `testing`
- `upstream`
- `waggle`

Multiple area labels are allowed when the issue crosses product surfaces.

## Transition Rules

- Unlabeled issues normally move to `needs-triage`.
- `needs-triage` can move to `needs-info`, `ready-for-agent`, `ready-for-human`, or `wontfix`.
- `needs-info` returns to `needs-triage` when the reporter or maintainer answers.
- `ready-for-agent` requires actionable acceptance criteria and enough context for an AFK agent.
- `ready-for-human` requires a clear reason why it is not safe to delegate.
- Conflicting state labels should be resolved before any other triage action.
