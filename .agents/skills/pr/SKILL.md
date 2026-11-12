---
name: pr
description: Prepare and open a draft GitHub pull request from the current branch. Use on /pr or when asked to commit, push and open a PR. Makes atomic Conventional Commits, pushes with hooks running, and creates the draft through bun run pr:create.
---

# PR

Turn the current branch's work into atomic commits, push it, and open a draft PR (against `main` unless another base is named).

## Rules

- Invoking `/pr` approves committing and pushing this branch and opening one draft PR for it. It approves nothing else: no merge, no ready toggle.
- Commit subjects are Conventional Commits (`type(scope): subject`, types `feat fix docs test chore refactor perf ci build revert`). `scripts/check-conventional-commits.ts` is the policy.
- Hooks always run. Never pass `--no-verify` or set `HUSKY=0`. When a hook fails, fix the cause and commit or push again. When the cause is outside the branch (a flaky test the diff does not touch, the network, the machine), stop and report it with the failing output.
- Create the PR only through `bun run pr:create`, never `gh pr create` directly. The wrapper always opens a draft. Its base is `main` unless `--base` names another branch. It requires a body file built from `.github/pull_request_template.md`, refuses a branch that is not pushed, and runs the commit policy on the title.
- The PR title becomes the squash commit subject, so it must describe the whole change. A PR that touches `packages/` needs a `feat`, `fix` or `revert` title (see `docs/agents/release.md`).
- Force pushes are refused, with no prompt and no override: the `pre-push` hook rejects a push that drops commits from the remote, and `.pi/extensions/git-guardrails.ts` blocks `--force` and its variants. Fix history with a new commit.

## Workflow

1. Inspect the branch:

   ```bash
   git status --short --branch
   git diff --stat
   git log --oneline origin/main..HEAD
   ```

2. On `main`, stop and ask for a branch name.
3. Group the uncommitted changes into atomic commits, one logical change each. Leave out work you did not make. If ownership is unclear, ask.
4. Commit each group: `git add <paths>` then `git commit -m "<subject>"`. Re-check `git status --short` after each one.
5. Push: `git push -u origin <branch>`, or `git push` when the upstream exists. The pre-push hook runs the fast verify; do not run it again by hand.
6. Write the body to a file in the session scratch directory, starting from `.github/pull_request_template.md`. Keep every `##` heading. Fill in the summary, the user-facing release notes when the change is visible to users, links (`Closes #<n>` or `Part of #<n>`), and the validation you ran. Pass an absolute path: `bun run` starts in the repository root.
7. Create the draft:

   ```bash
   bun run pr:create -- --title "<conventional subject>" --body-file "<absolute path>"
   ```

   Other `gh pr create` flags (`--label`, `--reviewer`) pass through. On failure, read the `pr:create:` message, fix the cause and run it again. If `gh` itself failed, check `gh pr view` before retrying so you do not open a second PR.

8. Report the commits, the push and hook result, the draft PR URL, and anything still unverified. The next step is `/ready` once the work is done.
