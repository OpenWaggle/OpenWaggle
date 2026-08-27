import { describe, expect, it } from 'vitest'
import {
  collectScriptedElectronLaunchViolations,
  collectSessionSummaryColumnViolations,
  collectUnguardedDesktopUiViolations,
  containsSessionBranchPrefix,
} from '../check-repository-standards'
import { withoutCommentLines } from '../standards/comment-stripping'

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

describe('non-disruptive Electron automation boundary', () => {
  it('rejects native dialogs, external applications, and window activation in main code', () => {
    const source = [
      'dialog.showMessageBox({ message: "Continue?" })',
      'shell.openExternal("https://example.com")',
      'mainWindow.show()',
      'mainWindow.focus()',
    ].join('\n')

    expect(collectUnguardedDesktopUiViolations('src/main/feature.ts', source)).toHaveLength(3)
  })

  it('rejects scripted Electron launches that omit explicit automation mode', () => {
    const unsafe = "const app = await electron.launch({ args: ['.'], env: {} })"
    const misleading =
      "const marker = 'OPENWAGGLE_AUTOMATION'; electron.launch({ args: ['.'], env: {} })"
    const aliased =
      "import { _electron as appDriver } from '@playwright/test'; appDriver.launch({ env: {} })"
    const safe = "launchOpenWaggleElectron({ userDataDir, hidden: true })"

    expect(collectScriptedElectronLaunchViolations('scripts/qa.ts', unsafe)).toHaveLength(1)
    expect(collectScriptedElectronLaunchViolations('scripts/qa.ts', misleading)).toHaveLength(1)
    expect(collectScriptedElectronLaunchViolations('scripts/qa.ts', aliased)).toHaveLength(1)
    expect(collectScriptedElectronLaunchViolations('scripts/qa.ts', safe)).toEqual([])
  })

  it('recognizes Electron Vite launches with either quote style', () => {
    const source = 'spawn("pnpm", ["exec", "electron-vite", "dev"])'
    const aliased = [
      "import { spawn as run } from 'node:child_process'",
      'run("pnpm", ["exec", "electron-vite", "dev"])',
    ].join('\n')

    expect(collectScriptedElectronLaunchViolations('scripts/unsafe.ts', source)).toHaveLength(1)
    expect(collectScriptedElectronLaunchViolations('scripts/unsafe.ts', aliased)).toHaveLength(1)
  })

  it('rejects aliased Electron desktop UI imports and visible window construction', () => {
    const source = [
      "import { shell as osShell, BrowserWindow as BW } from 'electron'",
      "osShell.openExternal('https://example.com')",
      'new BW({ show: true })',
    ].join('\n')

    expect(collectUnguardedDesktopUiViolations('src/main/unsafe.ts', source)).toHaveLength(2)
    expect(
      collectUnguardedDesktopUiViolations('src/main/unsafe.ts', 'new BrowserWindow()'),
    ).toHaveLength(1)
    expect(
      collectUnguardedDesktopUiViolations('src/main/unsafe.ts', 'new BaseWindow()'),
    ).toHaveLength(1)
  })

  it('rejects local aliases and broad imports of native window constructors', () => {
    const localAlias = [
      "import { BrowserWindow } from 'electron'",
      'const WindowCtor = BrowserWindow',
      'new WindowCtor()',
    ].join('\n')

    expect(collectUnguardedDesktopUiViolations('src/main/unsafe.ts', localAlias)).toHaveLength(1)
    expect(
      collectUnguardedDesktopUiViolations(
        'src/main/unsafe.ts',
        "import * as Electron from 'electron'; const WindowCtor = Electron.BaseWindow",
      ),
    ).toHaveLength(1)
    expect(
      collectUnguardedDesktopUiViolations(
        'src/main/unsafe.ts',
        "import Electron, { app } from 'electron'; new Electron.BrowserWindow()",
      ),
    ).toHaveLength(1)
    expect(
      collectUnguardedDesktopUiViolations(
        'src/main/safe-types.ts',
        "import { type BrowserWindow } from 'electron'",
      ),
    ).toEqual([])
  })

  it('allows the audited policy owner and test stubs', () => {
    const source = 'dialog.showMessageBox({ message: "Continue?" }); mainWindow.show()'

    expect(collectUnguardedDesktopUiViolations('src/main/desktop-ui.ts', source)).toEqual([])
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
    const contents = 'sql<SessionSummaryRow>`SELECT COUNT(*) AS total, MAX(created_at) FROM sessions`'

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
