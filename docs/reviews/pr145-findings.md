# PR #145 — Independent review findings and disposition

Three independent reviewer agents (pi on Bedrock, `eu.anthropic.claude-opus-4-6-v1`) reviewed the branch read-only against the merge base `34d955ed`, with scoped briefs:

| Reviewer | Scope | Report |
| --- | --- | --- |
| 1 | main process, IPC, shared contracts | [`pr145-reviewer-1.md`](./pr145-reviewer-1.md) |
| 2 | renderer: diff panel + review flow | [`pr145-reviewer-2.md`](./pr145-reviewer-2.md) |
| 3 | renderer: composer / run-target selector, settings, test quality | [`pr145-reviewer-3.md`](./pr145-reviewer-3.md) |

Totals: **0 BLOCKER, 1 MAJOR, 10 MINOR.** Eight fixed, three rejected with evidence.

## Fixed

### MAJOR — double-submit race in review submission
`useDiffReviewActions.ts` · reviewer 2

`onSubmitReview` read `comments` from the render closure. Two invocations landing before React re-rendered with the cleared array both passed the emptiness guard, so the agent received the same review twice. Now reads `useReviewStore.getState()` imperatively.

This also closes reviewer 2's related MINOR about the `Cmd+Enter` path in `ReviewBar`, which shared the same root cause — the guard is in the handler, so every caller is covered.

**Proven, not assumed.** A component test could not reproduce it: React Testing Library flushes a re-render between two `fireEvent.click` calls, so the second click already sees the cleared array — an earlier attempt passed with the fix reverted and was deleted for proving nothing. The regression test is at the hook level (`useDiffReviewActions.component.test.tsx`), invoking one captured handler instance twice inside a single `act()`, which is what a fast double-click or key repeat actually does. With the fix reverted it fails: `expected "vi.fn()" to be called 1 times, but got 2 times`.

### MINOR — closing tag inside a user comment breaks the payload
`review-comment-payload.ts` · reviewer 2

A pasted `</review_comment>` ended the block early and handed the agent a truncated, malformed payload. Now neutralised to `<\/review_comment>`, so the reviewer's text still reaches the agent. Covered by a unit test asserting exactly one structural closing tag remains.

### MINOR — `baseRef` bypassed the schema layer
`status-handler.ts` · reviewer 1

`git:branch-diff` validated `baseRef` with a plain `typeof` check while every other handler decodes. A non-string silently collapsed to the automatic-base empty string, masking a renderer bug. Now decoded through a new `branchDiffBaseRefSchema`, so a bad value is loud. The empty-string-means-automatic contract is documented on the schema.

### MINOR — dead design token
`globals.css` · reviewer 2

`--color-diff-add-text` was defined and never consumed by any utility or override. Removed.

### MINOR — unnamed `role="switch"` control
`AppearanceSection.tsx` · reviewer 3

The wrap-long-lines switch had no `aria-label`, so its accessible name was its entire inner text including the description sentence. Added `aria-label="Wrap long lines"`.

### MINOR — `aria-current="false"` on every unselected ref row
`BranchPickerList.tsx` · reviewer 3

Spec-equivalent to absent, but some screen readers announce "not current" per row. Now `isSelected || undefined`. The test that asserted `"false"` was corrected to assert absence — the stronger claim.

### MINOR — local-mode ref selection had no test
`RunTargetPicker.component.test.tsx` · reviewer 3

`selectRef` branches on environment mode; only the worktree branch was covered, so removing the early return would not have failed any test. Added a test asserting `checkoutGitBranch` is called and `setBaseRef` is not.

## Rejected, with evidence

### `skill-catalog.ts` exceeds the 300-line cap · reviewer 1
Not a violation as configured. `eslint.config.ts:74` sets `'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: false }]`. The file is 301 *raw* lines; blank lines are skipped, so it is under the cap and `pnpm lint` is green. The reviewer counted raw lines.

### `getGitBranchDiff` throws instead of returning a discriminated union · reviewer 1
Real inconsistency with our standard, but pre-existing and out of scope. It matches the established `getGitDiff` pattern that the existing `git:diff` handler and its renderer callers depend on; converting one of the pair would leave the two sibling handlers inconsistent, and converting both changes a contract this PR does not otherwise touch. The reviewer explicitly offered this as acceptable to defer. Worth a follow-up that migrates the whole `status-service` surface together.

### `--diffs-scrollbar-gutter-override` is unmapped · reviewer 2
The premise is inaccurate: the `.diff-chrome` comment claims each override *below* is a Derived token, not that every override the library exposes is mapped. Mapping it would also be actively worse — the library derives the gutter from the *measured* scrollbar width, and pinning it to a hardcoded `4px` risks misaligning the gutter whenever the real scrollbar differs. Leaving the library's measurement in charge is correct.

## Validation after the fixes

`pnpm check` exit 0 · unit **1877** · component **523** · integration **124** · React Doctor **100/100, no issues**.

One caveat on the unit suite: `src/main/store/__tests__/settings.unit.test.ts` intermittently emits `[vitest-pool]: Timeout terminating forks worker`, which truncates the run's reported totals. It is a teardown flake, not a failure — the file passes in isolation and a clean re-run reports 351/351 files and 1877/1877 tests.
