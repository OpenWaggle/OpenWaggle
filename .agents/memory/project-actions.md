# Project Actions and workspace preparation

Native Project Actions (ADR 0035) and workspace preparation: definitions and sharing,
shortcut bindings, Setup dispatch per worktree generation, the guided action panel, action
output views, and which project the actions follow.
Load when touching `features/project-actions`, `project-action*` or Setup capture code.

## Project action bindings are an ordered rule stack

Project action bindings deliberately do not use the conflict-free product Shortcut registry. T3 Code resolves its full keybinding list from the end, and several conditional rules may target the same project action or chord. OpenWaggle preserves that behavior: `when` uses the T3 boolean grammar, unknown context names are false, and the last active matching rule wins. Likely overlap is a warning, not a save blocker. Keep the legacy one-shortcut project shape readable, but write the ordered multi-rule shape after an action is edited.

## Setup dispatch belongs to a worktree generation

A Setup action needs a durable per-worktree-generation dispatch record, not a callback attached only to `git worktree add`. Record pending intent before Git creation or manual recreation and preserve it through deterministic adoption. Before terminal handoff, atomically change pending to claimed with a unique token. A reported pre-handoff failure may release that exact claim for retry; terminal acceptance marks it accepted without deleting the receipt. SQLite and a PTY cannot share a transaction, so a claimed row left by a crashed process is indeterminate and must never replay automatically. This gives arbitrary setup side effects at-most-once crash behaviour. It does not promise exactly-once shell execution, and the user may need to run the visible action manually when a crash happened before delivery. Legacy recorded trees have no row and do not run Setup retroactively.

Before starting a Project Action or Pi agent run in a managed worktree, compare the checkout's current directory identity with its saved preparation generation. A worktree recreated at the same path outside OpenWaggle can otherwise reuse Setup exports from the removed checkout. Guard both launch paths before handing those exports to an action runner or Pi shell; a worktree with no preparation snapshot remains launchable. POSIX Setup capture must also intercept escaped `\eval` (including dynamic nested eval) before its text can reach an escaped `\exec` and replace the shell without saving new exports. Test the capture behavior across the installed POSIX shells.

## One guided panel owns every action and preparation editor (ADR 0038)

Add/Edit action, Workspace setup/cleanup and the shared-preparation review all render in `ActionPanelLayout`, a shell-level `RightSidebarLayout` wrapped around `WorkspaceRightPanel`. It takes the single right-sidebar slot through a dedicated `action-panel` coordinator claim that remembers the claim it replaced, so closing restores that sidebar; any other sidebar taking the slot forgets the panel request but keeps its draft. A route or workspace release while the panel covers it clears the remembered claim, so a closed sidebar is never resurrected. Drafts persist per project under `openwaggle:action-panel:v1` and are validated with a lenient schema on load (drafts may be incomplete); one draft per project, resumed by target (`action:<id|new>` or `preparation:<profile>:<phase>`). Saving re-reads the catalog first, so changes made meanwhile surface as the plain "changed since you started" notice rather than the main process's generic revision error. Component tests must wait for the form, not only the panel: the loading chrome renders the same Close button and is replaced before a click lands. A preparation draft finds its saved setup by profile/phase slot, never by definition id: peers create independent ids for one slot and a save replaces the slot, so an id lookup reports a peer's replacement as "removed" and then overwrites it. Remembered script commands (for "Use the last known command instead") live in their own per-project store, `openwaggle:action-panel:script-commands:v1`, so typing never rewrites them. The panel's Escape entry is `enabled` only while focus is inside it: an enabled entry that declines through `shouldHandle` blocks every other `useEscapeHotkey` consumer. Saver enablement for shared preparation lives in the domain (`withSaverEnablement`), and a byte-identical re-save of someone else's pending change never enables it.

## Action output terminal views are not terminals (ADR 0043)

A read-only action output tab lives in its own store (`features/terminal/state/action-output-view-store.ts`, `openwaggle:terminal-action-output-views:v1`), never in the PTY layout: a view has no terminal id, so close/split/clear/dock and the PTY lifecycle cannot reach it. It is keyed `(ownerKey = Session id, actionId)` and stores only the followed run ids; output is re-read from the Host's `output` pages on mount, so persistence after restart is cheap. A view covers the drawer only while the terminal tab that was active when it was chosen is still active (`coveredTabId`), so any shortcut that creates or selects a terminal tab uncovers it without extra wiring. Restart-following appends the next run of the same action only once the followed run is no longer active, so a concurrent finite task cannot take the view over. xterm needs `scrollOnEraseInDisplay` and the feed strips ED3 (`ESC[3J`, held across page boundaries), otherwise a dev server's clear-screen erases earlier runs above the "restarted" divider.

## Project Actions follow the open Session's project, not the project preference

`settings.projectPath` only mirrors the selected project. When you select a Session, the chat store changes first, then the preference is updated through an awaited Host `settings:update`. If that write lags or is refused (Host stall, drain), the preference keeps naming the previous project until the next switch. Project Actions surfaces read it, so they listed the previous project's actions inside the new Session, and Add action saved there. That made actions look like they leaked between projects.

Project-scoped Session consumers resolve the project through `useSessionProjectPath` (`features/sessions/hooks`, `resolveSessionProjectPath`). With a selected Session it returns, in order:
- the loaded detail's project;
- otherwise the catalog summary's project (active, archived or Hive list);
- otherwise `null`, never the previous project.

Without a Session it returns the preference.

Its users:
- the Project Actions right panel surface, background effects, rail entry and running dot;
- action shortcuts and the command palette;
- Settings → Shortcuts (action rows only; extension panels mirror the rail);
- the Settings resource-project default (Session project, then preference, then recents).

Drafts deliberately stay on the preference. The draft composer (send gate, worktree plan stash, branch row, scoped drafts, preparation choice) and first send all key on it. Moving only some of them to `draftSession.projectPath` split the env/base-ref choice from the created Session. A draft whose sidebar project differs from a stale preference, New Session (⌘N) seeding from the preference, the header label and the extension panel rail are known follow-ups.

Reproduced in hidden Electron QA by delaying or failing the renderer's settings write.

## Project Action completion is not an activity-change event

The reuse barrier must observe every successful process sample, including an unchanged idle snapshot. The authenticated next prompt is authoritative on integrated shells. A fast command can start and finish between polls, so two reliable idle observations after a 1.5-second grace release that missed transition; any unreliable sample resets the streak. This fallback cannot identify a long-running builtin in an unsupported shell because no child process or authenticated prompt exists, so keep that limitation visible in user documentation.

## Filed under "Startup compatibility needs persisted-profile tests"

On the local macOS host, login-shell probes with long `-c` arguments exited via signal before producing output, including a harmless `printf` followed by a long comment. Keep the allowlisted capture command compact with one loop, not one expanded capture block per variable. The compact probe preserves markers, shell startup, timeout, output bound, and process-tree cleanup. The exact OS-level signal source was not established.

## Filed under "Session Host authority and subscriptions are live boundaries"

Native Project Actions are specified in ADR 0035. Definitions are project-scoped and private by
default; only explicit sharing writes `.openwaggle/actions.json`. The detached Session Host owns
action processes, while the GUI reconnects to durable run IDs and output cursors. Workspace mutation
admission must serialize launches against final binding release and physical worktree removal.
The native action manifest caps shortcut rules both per action and across all actions in one
manifest at the shared 256-rule project limit. Also count the effective catalog after personal
overrides merge with shared definitions: independently valid manifests can otherwise exceed the
project limit. Enforce this on read and edit before Settings builds its pairwise shortcut browser
rows, counting a hidden shared definition only when it is not overridden.
Keep the Pi-native `project_actions` tool's registered schema flat at the root. Some
OpenAI-completions providers emit empty arguments for a root `anyOf`; use an `action` literal union
with optional fields in the provider schema and validate each action's required fields before work.
Output polling stops after the final page of a terminal run. Publish terminal status only after
process cleanup, output flush and metadata persistence succeed; concurrent Stop joins that pending
finalization instead of writing a later stopping status over completion. Failed finalization keeps
the run active and owned so its error remains visible and Stop can retry.
Preparation snapshots retain private successful exports and require review for changed shared
execution. A failed cleanup keeps the worktree and must remain discoverable in Settings after the
owning Session has been deleted. Pending worktrees can have ordinary future filesystem paths, so
definition management must use authoritative lifecycle state instead of testing only `pending://`.
Profile moves are execution changes even when setup commands match. Retain the approved profile's
name and ID in local review records so the dialog can show the old and new profiles after deletion;
older reviews can recover the ID from a validated execution fingerprint.
Settings worktree removal must validate Git's non-forced dirty-worktree refusal before running
arbitrary Cleanup, then revalidate after Cleanup because the command itself can dirty or lock the
checkout. Keep both checks inside the admitted removal operation. If Git refuses after Cleanup
succeeded, retain that completed preparation in Settings and offer Retry removal, Delete anyway,
and an explicit Force remove decision. Parse `locked` records from `git worktree list --porcelain -z`;
Git requires two force flags to remove a locked checkout, so never apply them without the user's
explicit force choice.
Workspace deletion cascades preparation secrets and action records, then drains a durable output
cleanup queue. Disk cleanup failures remain queued and must not block Host startup or other owners.
Action copy buttons use the existing Electron clipboard bridge; the browser clipboard API is denied
by the renderer permission policy. Copied task invocations must quote literal arguments for the shell.
Final local Session deletion retires its Workspace resource only after all durable bindings,
including archived Sessions, are gone; stop finite runs as well as services before that cascade.
Setup capture must use the ordinary action shell resolver and shell-native exit handlers, including
fish, so configured shell syntax and explicit successful exits preserve exported environment.
Fish reserves `exec` as syntax, so a function named `exec` cannot intercept process replacement.
Rewrite direct Fish Setup command-position `exec` to a helper that snapshots exported values before
the real `exec`; preserve arguments, quoted text, and comments.
On Windows, resolve PATHEXT shims before extensionless files when an action command has no
extension. npm/Corepack directories can contain both a POSIX shim and a `.cmd` shim; choosing the
POSIX file bypasses the PowerShell wrapper and fails in node-pty. Output-derived previews must
accept complete IPv4 loopback addresses, not DNS names that merely start with `127.`.
POSIX setup may source scripts that register their own EXIT cleanup; keep the environment capture
handler authoritative while preserving user cleanup, including explicit successful exits.
POSIX setup may also replace its shell with `exec`, which skips EXIT capture. Expand an `exec`
alias only when parsing user commands so a snapshot is written before replacement, including from
sourced scripts. Expand capture through a silent command substitution within the same `exec` command:
splitting it with `&&` drops temporary assignments such as `FOO=bar exec tool`, while a shell
function around `exec` breaks redirect-only forms such as `exec >log`.
The valid `command exec` and `builtin exec` forms suppress the direct `exec` alias. Snapshot when
their prefixes expand too; retain their command status and temporary-assignment behavior.
An unquoted escaped `\\exec` suppresses alias expansion while still invoking the shell builtin.
Normalize that token in a direct POSIX setup command before parsing it for capture, preserving
quoted literals, comments and heredoc bodies.
`command trap` and `builtin trap` can bypass a `trap` function or alias in sourced setup scripts.
Route their prefixed forms through capture's saved-trap handler, while retaining pre-assignment
environment snapshots for prefixed `exec`. Ksh-style function definitions preserve temporary
assignment export behavior in ksh. Run saved EXIT cleanup with the setup's original status as
`$?`, including failed exits under `set -e`; the final process status remains the setup status.
One-argument `trap EXIT` and `trap 0` reset only the saved user cleanup; they must retain the
environment-capture handler. Select the first available capture-capable shell among the normal
shell candidates, so an unsupported configured shell does not block setup when a fallback exists.
Fresh local Sessions need Summary availability from configured preparation, before a snapshot or
run exists, or users cannot reach explicit setup.
Native actions use Local Session protocol revision 17 and require matching clients/Host for this
breaking migration. Revision 16 belongs to Host-owned Session resources, revision 15 to worktree
launch events and revision 14 to update channels; their published tuples stay unchanged, but removed legacy action channels make all three
older revisions incompatible. Keep safe Host drain/handoff.
Package task discovery checks the nearest package lockfiles before walking toward the Workspace
root when no packageManager is declared; explicit child and root declarations keep precedence.
The 1,000-task discovery page is a UI bound, not a validity bound for saved actions. Resolve an exact
saved package or Hatch reference through its provider and current source even when it lies beyond
the page, while still checking that the source belongs to the declared workspace and the task exists.
The Actions menu must not disable a saved task merely because its reference is absent from that
capped page; let backend preflight validate it at launch. Cargo aliases beginning with `+` are
toolchain selectors in Cargo's CLI, so reject them even though other task names may use `+`.
Keep aggregate task-limit diagnostics project-relative; their `source` is rendered in the editor.
In Setup shell capture, rewrite escaped `eval` only when it is a command (including after shell
keywords), not when it is an unquoted argument. Apply the same rule to code reparsed by runtime
`eval`, or preparation can change captured environment values such as `printf '%s' \eval`.
Determine command position by scanning shell words: quoted or escaped whitespace and separators
may belong to an assignment prefix before `\eval`, so a whitespace-only prefix regex can miss
the command and let a following escaped `exec` bypass capture.
A `)` after a `case` pattern starts the arm's command list, including when an optional `(`
opens that pattern, even on a later line; treat the closer as a command boundary in both static and runtime scanners
while retaining nested group state for other parentheses.
Leading redirections, including an optional numeric descriptor and a separately quoted target,
also preserve the next command position; consuming a redirection target must not make an
escaped `eval` argument of a preceding command look like a new command.
Treat a standalone `{` as a shell command prefix, but keep braces embedded in parameter and
brace expansion words; those expansions must not turn an escaped `eval` argument into a command.
An unquoted backslash-newline pair is removed before shell tokenization; prefix scanners must
skip it without adding a word, whether `\eval` is the next command or an ordinary argument.
Interrupted sharing journals pin the filesystem directory identity and durable Workspace resource.
Recovery keeps a draft when the checkout is missing, replaced, or releasing; publication must never
recreate a deleted checkout. Private preparation retains its profile metadata so a teammate removing
the shared profile cannot invalidate unrelated local configuration.
Deleting a local profile override should reveal the same-ID shared profile when one exists, even
if Setup uses it; explicit deletion must not rehydrate the local copy and mask later shared edits.
Fish reserves `eval` and `exec`. Rewrite evaluated commands at runtime, but execute `eval` in its
caller scope so local exported variables survive until Setup's environment capture.
Fish command substitutions start a nested command position. Their closing `)` restores the
enclosing command's argument position in both the static and runtime scanners; otherwise an
escaped `eval` argument after the substitution can be rewritten as a command.
PowerShell native-exit classification may resolve inert string concatenation in a command target,
but must not reevaluate a subexpression that can run user code.
Shared publication captures the current inode into a pinned, journaled recovery directory and
installs the prepared file with an exclusive hard link. Never replace a competing target or infer
completion from matching bytes alone. Keep both files in Git-ignored `.openwaggle/action-recovery/`
until manual review: editors holding an old descriptor can finish writing after publication.
Pending-save details expose the recovery path; missing or replaced recovery identities retain drafts.
Cargo alias discovery accepts both `.cargo/config.toml` and legacy `.cargo/config`, preserving the
selected source in saved task references and reporting conflicting files rather than guessing.
Successful setup stores explicit environment removals as private null markers. Apply these after
inherited environment construction for actions, cleanup and Pi shell tools; otherwise inherited
Host variables reappear after setup unsets them. Public preparation projections exclude this map.
Pi's shell spawn context starts from the detached Host environment, not Session workspace metadata.
Inject the Session's repository root and run working path into both Bash and PowerShell spawn hooks
after filtering inherited or prepared values for the reserved names; a test that pre-seeds those
paths into a mock spawn context misses this defect. Exercise the real Pi Bash tool as well.
Host recovery must mark interrupted preparation and action runs before replaying pending Session
deletions or worktree removals, so cleanup cannot execute twice after a crash. Preparation output
checkpoints retry from the last persisted revision. A failed final save retains a failed live
snapshot and prior successful environment, keeping Retry and Continue available until persistence
recovers. After an action process spawns, a failed write of its `running` status must return the live
run instead of reporting launch failure while leaving the process active. Keep Stop, output and
request replay available from the active map, and retry the durable status write for quiet services.
Agent authorization includes preview URL and automatic opening because both cause side
effects. Resolve relative PATH entries and executable paths from the action directory, including
setup shell selection. Hatch environments inherit ordinary scripts by name, but replace the entire
extra-scripts option; parent matrices do not make explicitly named child environments ambiguous.
Action approval messages use the current Session workspace as `.`. Keep the absolute workspace path
only in the hashed authorization scope so separate worktrees cannot share an approval, and never
render OpenWaggle's worktree-storage path in Start, Restart or Stop prompts.
Bind renderer Start and Restart requests to the execution key of the displayed definition. The
Host must refuse a changed action before launching a command that differs from what the user saw.
Use an ordinary scrolling container around the disabled action-editor fieldset; Chromium fieldset
overflow can paint over a fixed footer. Keep save errors in a bounded area above that footer so
revision-conflict recovery stays visible even when the form body is scrolled to the top.
Action-run polling queries all active runs plus the latest 50 terminal runs through indexed partial
branches. Additive migration 61 keeps older runs and request IDs available for detail lookup and retry
deduplication; limiting polling must never truncate the active-run set.
On macOS, setup environment capture uses bundled Perl to emit NUL-separated values because `env -0`
is not a documented cross-version contract; preserve embedded newlines. Resolve task executable paths
through the action runner's PATH/PATHEXT lookup before embedding them in a PowerShell setup wrapper,
so Windows selects the same `.cmd` shim as an ordinary action run.
Reconcile unsent worktree preparation choices against catalog updates even when the chooser becomes
hidden with only one profile; a deleted profile must not remain in the draft sent to a new Session.
Before a first worktree send creates a Session, read the live project catalog and require an explicit
valid profile when more than one exists. This preflight must run for classic and Waggle sends even
while the chooser's catalog request is still loading; otherwise the new Session can strand the first
message at setup snapshot capture. Carry the preflighted sole profile ID across Session creation and
select it explicitly; another window may add a profile before the first turn. Automatic Setup belongs
only to the durable worktree-birth callback. An idle Setup selected or adopted on an existing checkout
remains manual until the user chooses Run setup. Bash/zsh Setup trap introspection (`trap -p EXIT`
and bare `trap`) must report the saved user handler, never the private environment-capture handler:
a sourced script that saves and later evaluates the private handler recurses at exit. POSIX Setup
capture must snapshot before each runtime `eval` and normalize escaped `exec` inside literal
eval bodies so the exec alias captures any exports made within the evaluated string. Dynamic
`eval "$code"` needs a runtime rewrite too: the static scanner cannot see its expanded body, and
an escaped `\exec` would replace the shell before its EXIT handler saves later exports. Preserve
quoted strings and heredoc bodies while rewriting, and fail Setup if the runtime rewriter fails.
ANSI-C-quoted Bash builtin names such as `e$'va'l` and `ex$'e'c` also suppress alias
expansion. Normalize those command words in both the static and runtime Setup scanners,
including numeric ANSI-C escapes, before an evaluated `exec` can skip environment capture.
Bash locale-quoted words such as `$"ev"al` and `ex$"e"c` suppress aliases in the
same way. Recognize their literal command names in both scanners without rewriting
ordinary arguments.
Gate dollar-quote parsing by the selected shell: dash lacks both ANSI-C and locale
quotes, while zsh accepts ANSI-C quotes but treats Bash locale quotes as literal `$`.
Resolve `sh` symlinks before choosing the parser mode, so Linux dash-backed `sh` and
macOS Bash-backed `sh` retain their own command behavior.
Action-run headings and repair drafts display the actual invocation directory relative to the
workspace or project root, including nested package paths.
PowerShell setup capture must decide success from the
last command's `$?`, using `$LASTEXITCODE` only for a failed final command. A handled earlier native failure can leave
`$LASTEXITCODE` nonzero even though the final setup command succeeded and exported its environment.
When that final command is a failed non-terminating cmdlet, `$?` is false while `$LASTEXITCODE`
can still be zero; return a nonzero setup status and do not persist the environment snapshot.
Apply the same final-status rule to ordinary PowerShell custom actions: an earlier handled native
failure must not mark a successful final command as a failed action. The single `.cmd`/`.bat` shim
wrapper still uses its direct native process exit code.
PowerShell Setup capture initializes its wrapper status to success before user code: a dot-sourced
script can `exit 0` from inside `try` before the post-command assignment. Its `finally` block must
still write the environment snapshot, while the preparation executor only reads it for exit code 0.
Within the Workspace mutation fence, archive first, then stop services only after the archive
commits and removes the last active binding. A failed archive must leave running services alive.
Managed-worktree Session deletion also validates Git before commit. Inspect the binding after the
delete operation before stopping action services: a dirty-worktree refusal leaves the Session and
its services active, while a post-commit cleanup error may still leave an orphan to stop.
After a committed archive or handoff, a service-stop failure must not make the mutation appear to
fail. Retry cleanup under the Workspace fence, checking active bindings again so a rebound Workspace
keeps its services. Managed runs retain ownership while stop cannot be confirmed.
Prepared setup exports must not capture or override OpenWaggle's current project root, worktree path,
or agent-run marker. Pi Bash and PowerShell receive the active run's authoritative Workspace context.
Persisted `starting` runs must be tracked before native launch. Stop aborts launch promptly and the
PTY checks cancellation immediately before spawning; any late process remains owned until its tree
is confirmed stopped, with failed cleanup visible and retryable.
If a launch fails after its initial `starting` save and persisting the terminal failure also fails,
retain the failed run in memory for polling and Stop. A concurrent Stop can write `stopping` after
the launch's terminal save, so Stop must persist the terminal result again before releasing the
starting entry. Only a durable terminal state may disappear from in-memory recovery.
Preparation launches need a linked abort signal passed into the process runner. Stop and Host
shutdown must settle while native PTY module loading is stalled, even if launch never returns.
Race launch against cancellation, check the linked signal before invoking the runner, and stop a
process returned late after cancellation without blocking the canceled caller.
Settings catalog, discovery, and edits use only the independently selected project path. Its active
Session scope is reserved for the running-actions summary, since that Session may use a worktree.
Shortcuts Settings reads and writes also use that project-only scope; runtime shortcut presentation
and the command palette may follow the active Session. A worktree-scoped definition must not become
a project-wide local override through a Settings edit.
Preparation approval fingerprints include the profile ID as well as phase and invocation. Moving
shared setup into another profile changes which workspaces enroll and requires renewed review, even
when the command itself is unchanged. Older fingerprints without a profile require reapproval.
If node-pty reports failed native resource drain after process exit, an action's close promise can
reject permanently. Once detached shutdown confirms the process tree is gone, persist a failed or
stopped terminal run with the drain error and release Host liveness; repeated Stop cannot repair the
already-settled drain promise. Keep the lease only when process-tree shutdown itself is unconfirmed.

Workspace preparation review writes two durable records: the project catalog's remembered approval
and the pinned Workspace snapshot. If snapshot persistence fails after a catalog edit, restore the
exact previous catalog review using the resulting catalog revision; never leave a shared setup
enabled for later worktrees when the approval request reported failure. For POSIX Setup capture,
escaped prefixes such as `\command exec` and `\builtin exec` suppress alias expansion just as
`\exec` does, so normalize those executable forms outside quotes, comments and heredocs before
evaluating the command.
Prefixed `builtin eval` and `command eval` must pass through the same runtime rewrite as plain
`eval`; otherwise an escaped `exec` can replace Setup before its new exports are captured.
For custom PowerShell actions, preserve a failed native command's `$LASTEXITCODE` instead of
collapsing every final failure to exit 1; cmdlet-only failures still use 1. Pending-publication
details shown in Settings must omit canonical Workspace paths and use a relative recovery path.
An exact saved package task must be matched directly against declared Workspace patterns instead
of enumerating the 250-package discovery page; still reject excluded, generated, symlinked, and
missing sources. Match exact Workspace globs with fast-glob's micromatch semantics: Node
`path.matchesGlob` misses leading `./` patterns and directories named by `/**` exclusions.
Normalize discovered sources and test exact exclusions against each ancestor. PowerShell keeps a
native `$LASTEXITCODE` across later cmdlet failures, so use the
final user command's kind before applying that code to an action's final status.
Force removal with `skipCleanup` must skip Cleanup for every persisted status, including `idle`;
otherwise an arbitrary cleanup command can run despite the user's explicit skip confirmation.
The pinned Workspace snapshot owns Setup review decisions independently of the latest project
catalog. A disabled shared Setup is still reviewable in the Session UI; keep Run setup gated until
the user enables that snapshot version. When recreating a missing managed checkout, hold the same
Workspace action mutation fence as starts and removals, stop runs from the old directory generation,
then reset preparation and create Git state so a new launch cannot reuse the old process.
Git may refuse a dirty or locked worktree before Cleanup changes its idle state, so Settings must
offer an explicit Force remove path on a non-main worktree row even without retained preparation.
PowerShell `CommandAst.GetCommandName()` is empty for a final `& $exe` invocation; resolve a
variable command name from the current script scope before deciding whether its failure owns
`$LASTEXITCODE`. Setup capture needs the same final-statement distinction as custom actions so a
later failing cmdlet cannot inherit an earlier native exit code.
The call operator can also target an indexed command name such as `& $commands[0]`; classify the
selected command before using `$LASTEXITCODE`. POSIX heredoc delimiters are shell words, not
identifier tokens: strip their quotes and escapes in both the static and evaluated-command scanners,
including punctuation such as `<<'END.JSON'`, and queue multiple pending heredocs.
POSIX command-position scanners must keep valid `command --`, `command -p`, and Bash
`time -p` prefixes while finding escaped eval/exec; the Setup command alias must also dispatch
the option-prefixed eval through its capture wrapper, since the shell builtin `command`
cannot invoke the wrapper function. `command -p --` is a valid combined prefix, while
`command -- -p` is an end-of-options command operand and must not be rewritten.
Arithmetic left shifts inside `$((...))` expansions and `((...))` commands are not heredocs;
both static and runtime Setup scanners must skip those operators so a later escaped exec
remains capturable. Inline `name() {` and `function name {` bodies also begin a new command
list: an escaped eval immediately inside the brace must be captured at command position.
POSIX Setup capture can write an early snapshot while intercepting `eval`, `command`, or
`builtin`. A later command name expanded from a variable can become `exec` without alias
expansion and replace the shell before its success handler runs. Treat such snapshots as
provisional: accept an environment export only after the handler completes or a known
literal exec path marks the export verified. Reject a successful process exit with only
the provisional snapshot rather than silently persisting stale preparation values.
Shell feature tests must probe the actual shell executable. `/bin/sh` supports Bash
locale-quoted words on macOS but is dash on Ubuntu CI, where the same syntax exits 127.
Restart uses the current catalog action, since a retained run stores its historical
definition; submit the current execution key and let Host preflight catch edits that race
the restart. A saved task missing from a complete discovery result is unavailable in the
menu. Missing tasks in capped or diagnostic-bearing discovery remain undecided until a
direct launch resolves the reference.
PowerShell call-operator targets can be member expressions
such as `& $commands.main`; resolve only inert variable, constant, index, and note-property
AST shapes when classifying the final command, without reevaluating user code or borrowing an
earlier native exit for a final cmdlet failure.
PowerShell's `& ($commands[0])` wraps the indexed target in a `ParenExpressionAst` containing
one `PipelineAst` and one `CommandExpressionAst`. Unwrap only that inert shape recursively;
leave pipelines and expressions with command calls unresolved so failure classification never
reruns user code.
Interpolated call-operator targets such as `& "$exe"` use `ExpandableStringExpressionAst`.
Reconstruct only literal segments without PowerShell escapes and nested inert string expressions;
reject command-bearing subexpressions so inspecting a failed native command never repeats effects.
An `Env:` command target is also a `VariableExpressionAst`, but `Get-Variable` cannot read the
environment provider. Resolve only `Env:` drive-qualified paths through the process environment;
leave other provider drives unresolved rather than invoking arbitrary provider behavior.
Static and runtime escaped-eval scanners must preserve the enclosing command prefix while an
unquoted `$()` spans physical lines. Keep physical line starts for heredocs, but save and restore
command starts at matching substitution parentheses; otherwise `) \eval` as an ordinary
argument can be mistaken for a case-arm command boundary.
Terminal history removal methods already await their queued mutations and discard failures for
the removed keys. A global `flush()` afterward can report an unrelated terminal write failure
after a successful close; use a key-scoped flush for one terminal, and rely on completed owner
or path removal without a global failure check. Preserve global flush on all-terminal shutdown.

Action run output cursors cannot be recovered from retained log length after scrollback
compaction: the Host may flush the log before its throttled SQLite `outputBytes` update. Journal
the append or replacement text with its absolute end cursor in one private atomic sidecar before
writing the log; recover an unfinished journal idempotently, then commit the cursor. Failed
history batches, including ordinary PTY output, must be retried with the same journal before
later writes for that key; keep errors scoped to their history key so an unrelated terminal
failure cannot block a healthy action. If a crash loses an
unflushed tail that the renderer already displayed, keep the renderer's cursor stable rather than
clearing its output.
Action `readWithCursor` must return the retained bytes counted by that cursor. Ordinary terminal
replay scrubbing removes C0 controls such as backspace, BEL, and NUL, so applying it before action
pagination shifts the apparent retained start and can repeat output or falsely report truncation.
Keep replay scrubbing on the plain terminal `read` path.
Draft-terminal owner migration must use the move operation's pending-write barrier and check
failures only for source and destination owners. A global history flush can block first send in a
healthy project when an unrelated terminal has a persistent history-write failure.
When removing or truncating history, discard retry and failure state inside the serialized
mutation after earlier writes settle; an in-flight flush can otherwise recreate deleted history.
