Review: (location: ReviewCommentLocation, content: string) => void
  readonly onRemoveComment: (id: string) => void

Took 0.0s


Now let me check the AppearanceSection for the role="switch" a11y concern — a Button
is being used as switch but has no aria-label:


$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && sed -n
'94,120p'
src/renderer/src/features/settings/components/sections/AppearanceSection.tsx

... (26 earlier lines, ctrl+o to expand)
                className={`size-3 rounded-full ${diffWrapLines ? 'bg-accent' :
'bg-text-muted'}`}
              />
            </div>
          </Button>

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && grep -rn
"renameGitBranch\|deleteGitBranch\|setGitBranchUpstream\|rename-branch\|delete-branc
h\|set-upstream" src/renderer/src/features/git/state/git-store.ts

(no output)

Command exited with code 1

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && grep -rn
"label\|aria-label" src/renderer/src/shared/ui/Button.tsx 2>/dev/null | head -5

(no output)

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && grep -n
"forwardRef\|interface\|type.*Props" src/renderer/src/shared/ui/Button.tsx | head
-10

19:interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {

Took 0.0s


Now I have enough information to write the review. Let me also quickly verify the
test coverage claim:


$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && git diff
34d955ed..HEAD -- src/renderer/src/features/composer/components/__tests__/ | grep
"^+\|^-" | grep -c "^+" ; echo "---"; git diff 34d955ed..HEAD --
src/renderer/src/features/composer/components/__tests__/ | grep "^+\|^-" | grep -c
"^-"

211
---
183

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && find
src/renderer/src/features/composer/components/__tests__ -type f | sort

... (21 earlier lines, ctrl+o to expand)
test.tsx
src/renderer/src/features/composer/components/__tests__/useVoiceCapture.component.te
st.tsx
src/renderer/src/features/composer/components/__tests__/VoiceRecorder.component.test
.tsx

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && grep -n
"openMenu\b" src/renderer/src/features/composer/state/composer-store.ts 2>/dev/null
| head -10

(no output)

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && grep -n
"branchMenuOpen\|openMenu"
src/renderer/src/features/composer/state/composer-store.ts | head -10

(no output)

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && grep -rn
"branchMenuOpen\|openMenu" src/renderer/src/features/composer/state/ | head -10

... (15 earlier lines, ctrl+o to expand)
s:24:    branchMenuOpen: false,
src/renderer/src/features/composer/state/__tests__/composer-action-store.unit.test.t
s:37:    useComposerStore.getState().openMenu('thinking')
src/renderer/src/features/composer/state/__tests__/composer-action-store.unit.test.t
s:43:    expect(useComposerStore.getState().branchMenuOpen).toBe(false)

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && grep -n "type
MenuKind" src/renderer/src/features/composer/state/composer-store-types.ts

4:export type MenuKind = 'thinking' | 'execution' | 'branch' | null

Took 0.0s


Now let me check the aria-current usage in BranchPickerList — passing a boolean to
aria-current:


$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && grep -B2 -A4
"aria-current" src/renderer/src/features/composer/components/BranchPickerList.tsx

... (3 earlier lines, ctrl+o to expand)
      className={cn(
        'flex w-full items-center justify-between border-b border-border px-2.5
py-1.5 text-left text-[12px] transition-colors last:border-b-0 hover:bg-bg-hover',
        isSelected ? 'text-accent' : 'text-text-secondary',
      )}

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && grep -rn
"selectRef\|onSelectRef\|checkoutBranch"
src/renderer/src/features/composer/components/RunTargetPicker.tsx

... (1 earlier lines, ctrl+o to expand)
selectRef(name: string) {
src/renderer/src/features/composer/components/RunTargetPicker.tsx:39:    void
controller.checkoutBranch(name)
src/renderer/src/features/composer/components/RunTargetPicker.tsx:67:
onSelectRef={selectRef}

Took 0.0s


Let me check one last thing — whether the menu closes after selecting a ref in local
mode:


$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && sed -n
'33,42p' src/renderer/src/features/composer/components/RunTargetPicker.tsx

... (5 earlier lines, ctrl+o to expand)
    }
    void controller.checkoutBranch(name)
  }

  return (

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && sed -n
'39,55p' src/renderer/src/features/composer/hooks/useBranchPickerController.ts

... (12 earlier lines, ctrl+o to expand)
    isBranchActionRunning: git.isBranchActionRunning,
    filteredBranches: branches.filteredBranches,
    localBranches: branches.localBranches,
    remoteBranches: branches.remoteBranches,
    openMenu,

Took 0.0s


Good — menu closes on success in both paths. Now let me check if there's a test that
actually tests local-mode checkout:


$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && grep -A15
"checks out in local"
src/renderer/src/features/composer/components/__tests__/RunTargetPicker.component.te
st.tsx 2>/dev/null; echo "---"; grep -A15 "checkoutBranch\|envMode.*local"
src/renderer/src/features/composer/components/__tests__/RunTargetPicker.component.te
st.tsx | grep -A15 "click\|fireEvent"

... (17 earlier lines, ctrl+o to expand)

  it('checks out a selected change request', () => {
    const checkoutChangeRequest = vi.fn(async () => true)
    useComposerStore.setState({ branchMenuOpen: true })
    render(

Took 0.0s


I notice there's no test that directly verifies local-mode ref selection calls
checkoutBranch. Let me also verify how the strip null case interacts with the
RunTargetPicker:


$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && sed -n
'27,42p' src/renderer/src/features/composer/components/RunTargetPicker.tsx

... (12 earlier lines, ctrl+o to expand)
    }
    void controller.checkoutBranch(name)
  }

  return (

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && wc -l
src/renderer/src/features/settings/components/sections/WorktreesSection.tsx

155 src/renderer/src/features/settings/components/sections/WorktreesSection.tsx

Took 0.0s



$ cd /Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle && wc -l
src/renderer/src/features/git/hooks/useSessionContextRow.ts
src/renderer/src/features/composer/components/RunTargetPicker.tsx
src/renderer/src/features/composer/components/RunTargetOptions.tsx
src/renderer/src/features/composer/components/RunTargetTrigger.tsx
src/renderer/src/features/composer/components/BranchPickerList.tsx

... (1 earlier lines, ctrl+o to expand)
      77 src/renderer/src/features/composer/components/RunTargetPicker.tsx
     118 src/renderer/src/features/composer/components/RunTargetOptions.tsx
      46 src/renderer/src/features/composer/components/RunTargetTrigger.tsx
     104 src/renderer/src/features/composer/components/BranchPickerList.tsx
     562 total

Took 0.0s


I have now reviewed all the relevant code. Here's my report:

────────────────────────────────────────────────────────────────────────────────

Review: Renderer — Composer / Run-Target Selector + Settings + Tests

### 1. Run-Target Picker (a743b0b1)

MINOR |
src/renderer/src/features/settings/components/sections/AppearanceSection.tsx:95-100
| role="switch" Button has no aria-label | Screen readers will announce the full
inner text ("Wrap long lines Wrap instead of scrolling horizontally, so review
controls stay in view.") as the accessible name — verbose and confusing, and differs
from how the test locates it ({ name: /Wrap long lines/ }). The test passes only
because RTL does partial matching. | Add aria-label="Wrap long lines" to the Button.

No issues found in the core run-target picker for:
- One control naming a ref ✓ — SessionContextRow owns only envMode, no branch string
  rendered. RunTargetTrigger is the single ref-naming control.
- Correct mode branch ✓ — selectRef in worktree mode calls strip.setBaseRef; in
  local mode calls controller.checkoutBranch.
- Null-strip handling ✓ — strip?.envMode === 'worktree' safely handles the null
  strip (falls through to local/checkout path). strip?.baseRef ?? null returns null,
  isMissing is false && ... so false.
- Menu closing ✓ — Worktree path closes via controller.openMenu(null). Local path
  closes via the .with({ ok: true }, () => openMenu(null)) inside checkoutBranch.
- Stale selectedRef ✓ — selectedRef is derived on every render from either
  strip.baseRef or controller.currentBranch (store selectors), no props-into-state.
- Lost onToast ✓ — onToast is plumbed from ChatComposerStack → ComposerBranchRow →
  RunTargetPicker → RunTargetOptions and into useBranchPickerController.

### 2. Accessibility

Correct | RunTargetOptions.tsx:62-70 | The replacement of <label htmlFor> with <div
aria-hidden> + ToggleSwitch(label="Start from origin") is correct. The ToggleSwitch
renders a <button role="switch" aria-label="Start from origin">. The aria-hidden
span ensures the visible text is not double-announced. The switch is announced
exactly once.

No dangling htmlFor found elsewhere in the changed composer/git features. The only
htmlFor in the scope (CommitDialogContent.tsx:114) points at a real
COMMIT_MESSAGE_ID input.

MINOR | src/renderer/src/features/composer/components/BranchPickerList.tsx:94 |
aria-current={isSelected} emits aria-current="false" for non-selected items |
WAI-ARIA spec says aria-current with false is equivalent to omitting it, but it's
uncommon and some older screen readers may announce "not current" for each row. |
Prefer aria-current={isSelected || undefined} to omit the attribute entirely when
false.

### 3. SyntaxThemePreview perf/lifecycle

No issues found. The component is well-designed:
- options is memoized with useMemo keyed on [theme], so re-renders from unrelated
  Settings state changes do not cause re-tokenization.
- The PREVIEW_PATCH is a module-level constant (stable identity).
- PatchDiff is rendered without WorkerPoolContext and without disableWorkerPool, so
  it will inline-tokenize. For this 9-line patch this is trivially fast. No worker
  pool is spun up by the preview alone.
- On unmount, there's nothing to leak — PatchDiff renders pure DOM with no
  subscriptions or timers for a static patch.

### 4. Test Quality

Net coverage is positive. The deleted BranchPicker.component.test.tsx (133 lines, 10
tests covering: render, open menu, filter, empty state, current-branch indicator,
action buttons) is fully superseded by RunTargetPicker.component.test.tsx (203
lines, 16 tests) which covers all those behaviours and adds worktree-mode selection,
missing-ref flagging, copy-to-clipboard, start-from-origin, change-request checkout.

Deleted behaviours and their fate:
- Rename/delete/upstream dialogs and tests: removed intentionally (ADR 0017), no
  longer in the store (ComposerActionDialogKind = 'create-branch' only). Tests were
  the only coverage, and the behaviour no longer exists. ✓
- Branch current indicator (●): now tested via aria-current assertion in
  RunTargetPicker.component.test.tsx:132.
- Branch checkout in local mode: not directly tested as a distinct assertion in the
  new suite. The test for "opens the menu and offers ref search" and the "sets the
  base ref" test cover worktree mode; local-mode checkout relying on
  controller.checkoutBranch is exercised only indirectly through the integration
  test in git-store.integration.test.ts.

MINOR |
src/renderer/src/features/composer/components/__tests__/RunTargetPicker.component.te
st.tsx | No test for local-mode ref selection triggering a checkout | The
RunTargetPicker's selectRef in local mode calls controller.checkoutBranch(name). If
someone regresses the mode branch (e.g. removes the early return), there's no test
that would fail. | Add a test: render with strip={stripState({ envMode: 'local' })},
open menu, click a non-current branch, assert api.checkoutGitBranch was called.

No hollow/meaningless tests found. All assertions test observable outcomes (DOM
queries, store state, mock calls).

────────────────────────────────────────────────────────────────────────────────

### Summary

┌──────────┬───────┐
│ Severity │ Count │
├──────────┼───────┤
│ BLOCKER  │ 0     │
├──────────┼───────┤
│ MAJOR    │ 0     │
├──────────┼───────┤
│ MINOR    │ 3     │
└──────────┴───────┘

The consolidation is clean. Architecture is respected (git feature exports from its
public index, composer imports types only, no cross-feature internal reach). File
sizes are within caps. The two old controls merged into one with correct
mode-dependent semantics.
