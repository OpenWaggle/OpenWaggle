import { describe, expect, it } from 'vitest'
import {
  collectScriptedAppLaunchViolations,
  collectSessionSummaryColumnViolations,
  collectUnguardedDesktopUiViolations,
  containsSessionBranchPrefix,
} from '../check-repository-standards'
import { withoutCommentLines } from '../standards/comment-stripping'
import { collectSyntaxRenderingViolations } from '../standards/syntax-rendering'

describe('session branch prefix detection', () => {
  it('matches the prefix wherever it appears, not only after a quote', () => {
    /*
     * Two rounds of review narrowed this guard. Template-literal-only missed
     * `const p = 'ow/session-x'`; requiring a quote immediately before the prefix still missed every
     * use where it is not at the start of the string, which is the most natural way to write it.
     */
    expect(containsSessionBranchPrefix('const a = `refs/heads/ow/session-${id}`')).toBe(true)
    expect(containsSessionBranchPrefix("const b = 'ow/session-' + id")).toBe(true)
    expect(containsSessionBranchPrefix('const c = "ow/session-probe"')).toBe(true)
    expect(containsSessionBranchPrefix('const d = sessionWorktreeBranch(id)')).toBe(false)
  })

  it('ignores the convention when it only appears in comments', () => {
    const source = [
      '// branches are named ow/session-<id>',
      '/* also ow/session- in a block */',
      'const branch = sessionWorktreeBranch(id) // and ow/session- in a trailing comment',
      'const url = "https://example.com/ow/session-docs"',
    ].join('\n')

    // The trailing-comment case regressed when the match was widened to the whole line.
    expect(containsSessionBranchPrefix(withoutCommentLines(source))).toBe(true)
    expect(
      containsSessionBranchPrefix(
        withoutCommentLines(
          ['// ow/session-<id>', 'const branch = sessionWorktreeBranch(id) // ow/session-x'].join(
            '\n',
          ),
        ),
      ),
    ).toBe(false)
  })
})

const DESKTOP_UI_POLICY_OWNER = 'src/main/adapters/electrobun/electrobun-window-policy.ts'

describe('non-disruptive desktop automation boundary', () => {
  it('keeps native context-menu presentation inside the desktop UI policy', () => {
    expect(
      collectUnguardedDesktopUiViolations('src/main/preview.ts', 'menu.popup({ window })'),
    ).toHaveLength(1)
    expect(
      collectUnguardedDesktopUiViolations(DESKTOP_UI_POLICY_OWNER, 'menu.popup({ window })'),
    ).toEqual([])
  })
  it('rejects native dialogs, external applications, and window activation in main code', () => {
    const source = [
      'dialog.showMessageBox({ message: "Continue?" })',
      'shell.openExternal("https://example.com")',
      'shell.trashItem("/tmp/openwaggle")',
      'mainWindow.show()',
      'mainWindow.focus()',
    ].join('\n')

    expect(collectUnguardedDesktopUiViolations('src/main/feature.ts', source)).toHaveLength(3)
  })

  it('keeps detached external-application processes inside the desktop UI policy owner', () => {
    const unsafe = [
      "import { spawn } from 'node:child_process'",
      "spawn('code', ['/tmp/example.ts'], { detached: true })",
    ].join('\n')
    const safe = "launchExternalApplication('code', ['/tmp/example.ts'])"

    expect(collectUnguardedDesktopUiViolations('src/main/feature.ts', unsafe)).toHaveLength(1)
    expect(collectUnguardedDesktopUiViolations('src/main/feature.ts', safe)).toEqual([])
  })

  it('allows only the detached spawn in the primitive the boot shim launches the Host with', () => {
    const primitive = 'src/main/detached-process.ts'
    const detached = [
      "import { spawn } from 'node:child_process'",
      "spawn(command, args, { detached: true, stdio: 'ignore' })",
    ].join('\n')

    expect(collectUnguardedDesktopUiViolations(primitive, detached)).toEqual([])
    expect(collectUnguardedDesktopUiViolations(primitive, 'mainWindow.show()')).toHaveLength(1)
  })

  it('starts the app for automation only through the automation launcher', () => {
    const unsafe = "spawn(launcher, [], { env: { ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: '9223' } })"
    const renderer = "const env = { OPENWAGGLE_QA_MAIN_WINDOW_RENDERER: 'cef' }"
    const safe = 'await launchElectrobunApp({ app, profile })'

    expect(collectScriptedAppLaunchViolations('scripts/qa.ts', unsafe)).toHaveLength(1)
    expect(collectScriptedAppLaunchViolations('scripts/qa.ts', renderer)).toHaveLength(1)
    expect(collectScriptedAppLaunchViolations('scripts/qa.ts', safe)).toEqual([])
    expect(
      collectScriptedAppLaunchViolations('scripts/support/electrobun-app-launch.ts', unsafe),
    ).toEqual([])
  })

  it('rejects visible window construction through any constructor expression', () => {
    expect(
      collectUnguardedDesktopUiViolations('src/main/unsafe.ts', 'new BrowserWindow()'),
    ).toHaveLength(1)
    expect(
      collectUnguardedDesktopUiViolations('src/main/unsafe.ts', 'new (sdk.BrowserWindow)({})'),
    ).toHaveLength(1)
  })

  it('allows the audited policy owner and test stubs', () => {
    const source = 'dialog.showMessageBox({ message: "Continue?" }); mainWindow.show()'

    expect(collectUnguardedDesktopUiViolations(DESKTOP_UI_POLICY_OWNER, source)).toEqual([])
    expect(
      collectUnguardedDesktopUiViolations('src/main/__tests__/desktop-ui.unit.test.ts', source),
    ).toEqual([])
  })
})

describe('SessionSummaryRow column detection', () => {
  const file = 'src/main/store/sessions/queries.ts'

  it('rejects an inline column list even when it omits the columns the row promises', () => {
    /*
     * The guard used to fire only when the list mentioned `created_at`, which let through exactly
     * the defect it exists for: three queries omitted `environment_mode` and `worktree_path`, so
     * every session reported local mode with no worktree and nothing failed.
     */
    const contents = 'sql<SessionSummaryRow>`SELECT id, title, project_path FROM sessions`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toHaveLength(1)
  })

  it('accepts a query that interpolates the shared column fragment', () => {
    const contents = 'sql<SessionSummaryRow>`SELECT ${sessionSummaryColumns(sql)} FROM sessions`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toEqual([])
  })

  it('ignores a count query, which selects no columns', () => {
    const contents = 'sql<SessionSummaryRow>`SELECT COUNT(*) AS total FROM sessions`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toEqual([])
  })

  it('still rejects an inline list that merely carries a COUNT subquery', () => {
    /*
     * The rule briefly skipped any query containing `count(` anywhere, which exempted exactly the
     * shape the detail-side row uses - so a list missing `environment_mode` and `worktree_path`, the
     * original production bug, went unreported again.
     */
    const contents =
      'sql<SessionSummaryRow>`SELECT id, title, project_path, ' +
      '(SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count FROM sessions s`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toHaveLength(1)
  })

  it('rejects an inline list that merely begins with an aggregate', () => {
    /*
     * The exemption matched any projection whose *first* term was an aggregate, so the column list
     * behind a leading COUNT(*) was skipped - the same hole as the version that skipped any query
     * containing `count(` at all, in a different disguise.
     */
    const contents =
      'sql<SessionSummaryRow>`SELECT COUNT(*) AS total, id, title, project_path FROM sessions`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toHaveLength(1)
  })

  it('still ignores a projection of aggregates only', () => {
    const contents =
      'sql<SessionSummaryRow>`SELECT COUNT(*) AS total, MAX(created_at) FROM sessions`'

    expect(collectSessionSummaryColumnViolations(file, contents)).toEqual([])
  })

  it('does not truncate code inside a multi-line template literal', () => {
    /*
     * Trailing-comment stripping tracked quotes within a line, so a line *inside* a template literal opened
     * earlier was scanned as code: a `//` in it - a URL, most obviously - deleted the rest of a real line
     * before the convention checks ever saw it.
     */
    const source = ['const help = `', '  See https://example.com/docs for details', '`'].join('\n')

    expect(withoutCommentLines(source)).toContain('https://example.com/docs for details')
  })
})

describe('syntax rendering architecture', () => {
  it('rejects Monaco dependencies and renderer imports', () => {
    expect(
      collectSyntaxRenderingViolations(
        'package.json',
        JSON.stringify({ dependencies: { 'monaco-editor': '0.55.1' } }),
      ),
    ).toHaveLength(1)
    expect(
      collectSyntaxRenderingViolations(
        'src/renderer/src/features/workspace-files/WorkspaceEditor.tsx',
        "import { editor } from 'monaco-editor'",
      ),
    ).toHaveLength(1)
  })

  it('keeps renderer workers module-split instead of inlining every grammar', () => {
    expect(
      collectSyntaxRenderingViolations(
        'vite.renderer.config.ts',
        "export default { worker: { format: 'es' } }",
      ),
    ).toEqual([])
    expect(
      collectSyntaxRenderingViolations(
        'vite.renderer.config.ts',
        "export default { worker: { format: 'iife' } }",
      ),
    ).toHaveLength(1)
  })
})
