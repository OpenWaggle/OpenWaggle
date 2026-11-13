---
name: ready
description: Take a draft GitHub PR to ready for review. Use on /ready or when asked to mark a PR ready. Runs fresh-context review rounds in Hive Worker Sessions until the review converges, then bun run pr:ready gates, publishes the blast radius and review evidence, marks the PR ready, and hands off to babysit.
---

# Ready

Move a draft PR to ready for review once an independent reviewer has reviewed its exact head.

## Rules

- The reviewer is a fresh Hive Worker Session created from the `standards-reviewer` Agent definition (`.agents/agents/standards-reviewer.md`), with no memory of writing the code. It reviews against `.agents/standards.md`, reports only, and has no edit or write tools. Never review your own work and call it independent.
- `bun run pr:ready` is the only way to mark ready. It refuses unless `--reviewed-sha` equals local `HEAD` and the PR head, runs `bun run check`, `test` and `build`, publishes the blast radius, posts the review evidence, then runs `gh pr ready`.
- Any commit after a review makes it stale. Push, then review the new head. After replaying the branch onto a moved main (a lease push to the same `ow/*` branch, see the git-guardrails skill), the new round reviews only the replay's difference: `git range-diff origin/main <old-head> HEAD`.
- Hooks always run; never skip them. When a hook or the gate fails, fix the cause. When the cause is outside the branch, stop and report it.
- Do not merge. The maintainer merges.

## Convergence

Severities are the ones in `.agents/skills/code-review/SKILL.md`: P0 security, data loss or release blocker; P1 likely functional bug or major regression; P2 moderate issue; P3 polish.

1. P0 and P1 must reach zero. Fix them, push, review again.
2. With P0 and P1 at zero, stop after two clean rounds in a row (no new P0 or P1), or after three rounds in total.
3. Then give every remaining P2 and P3 a disposition: fixed (commit SHA), tracked (a GitHub issue, `gh issue create --label needs-triage`), or accepted with a one-line reason.

A fresh reviewer almost always finds one more P3, so a review with zero findings at every severity never arrives. The round cap and the two-clean rule end the loop. Once P0 and P1 are at zero, change the diff only for a real defect. Refactoring for a P3 creates new code to review and restarts the count.

## Workflow

1. Check the state. The tree must be clean and the branch pushed, and the PR must be a draft whose head is local `HEAD`:

   ```bash
   git status --short --branch
   gh pr view --json number,url,isDraft,headRefOid
   git rev-parse HEAD
   ```

   Ask before committing or pushing anything the maintainer has not seen.

2. Run a review round. Spawn a Worker with the `hive` tool, `agent: "standards-reviewer"` and `workspace: "share-parent"` so it reads this checkout. The definition carries the role, so the objective only names the change:

   > Review PR #N (`git diff origin/main...HEAD`) at HEAD `<full sha>`.

   It returns findings grouped P0, P1, P2, P3, each with file:line, what it breaks (a lint rule name, a check step or `no-cheating/<kind>`, or a `standards.md` section), and the impact, and ends with `reviewed-sha: <sha>`. When the definition is not listed (`hive` `agent_definitions_list`), spawn without it and paste the definition's body into the objective.

   Add the blast-radius focus areas when you have them (`.tmp/pr/blast-radius.md` from a previous run). Wait with `hive` `wait` (timeoutMs up to 270000, repeat as needed), read the result, and accept the Delegation so the Worker archives.

3. Check the result: the `reviewed-sha` line must equal `git rev-parse HEAD`. If it does not, the round does not count.
4. Fix every P0 and P1, commit, push, and run another round with a new Worker. Repeat until the review converges (above).
5. Write the review evidence to a file in the session scratch directory:

   ```markdown
   ## Independent review

   - Rounds: 3 (P0/P1 per round: 1/2, 0/0, 0/0)
   - P0 and P1: none open
   - P2 `src/x.ts:40` stale cache key: fixed in abc1234
   - P3 `src/y.ts:12` naming: accepted, matches the surrounding module
   - P3 `docs/z.md` wording: tracked in #512

   reviewed-sha: <full sha>
   ```

6. Mark ready:

   ```bash
   bun run pr:ready -- --reviewed-sha <full sha> --review-file "<absolute path>"
   ```

   `--dry-run` runs every check and the gate and writes `.tmp/pr/` files without touching GitHub. Gate logs land in `.tmp/pr/gate-<script>.log`; a failure prints the end of its log.

7. Report the PR URL, the blast-radius and review comment URLs, the rounds, every P2 and P3 disposition, and the gate result.
8. Load `.agents/skills/babysit/SKILL.md` and run it on this PR in the same session, without waiting for the maintainer.

## When Hive is not available

Ask the maintainer for a reviewed SHA from their own review, or for "I reviewed it, mark ready", in which case use the current `HEAD` and say so in the evidence file.
