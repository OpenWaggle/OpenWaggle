import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

/**
 * Session-bound terminals in the real application (ADR 0030): the panel belongs
 * to the active session (or draft), new terminals start in the session's
 * Working path, and hiding, re-showing, and reloading never kill a shell.
 */

const SESSION_TITLE = 'Session terminal fixture'
const SESSION_USER_MESSAGE = 'Open the session terminal for this fixture.'
const DRAFT_PROJECT_LABEL = 'terminal-draft-project'
const WORKTREE_PROJECT_LABEL = 'terminal-worktree-project'
const WORKTREE_LABEL = 'wt-e2e-terminal'
const SHELL_OUTPUT_TIMEOUT_MS = 20_000
const HIDE_MARKER = 'TERMINAL_MARKER_123'
const AFTER_RESHOW_MARKER = 'AFTER_RESHOW_OK'
const RELOAD_MARKER = 'RELOAD_MARKER_42'
const OPEN_TERMINAL_DEFAULT_COLS = 80
const OPEN_TERMINAL_DEFAULT_ROWS = 24

function platformModifier() {
  return process.platform === 'darwin' ? ('Meta' as const) : ('Control' as const)
}

/**
 * xterm loads its WebGL renderer whenever a GPU (or SwiftShader) context is
 * available, which draws glyphs onto a canvas and leaves no output text in the
 * DOM. Returning null from canvas getContext makes the WebGL addon throw while
 * loading, which the pane's load path already treats as "fall back to the DOM
 * renderer" — so terminal output stays readable in `.xterm-rows` for
 * assertions without touching the production code.
 */
async function forceDomTerminalRenderer(page: Page) {
  await page.addInitScript(() => {
    const prototype = HTMLCanvasElement.prototype
    const nativeGetContext = prototype.getContext
    const webglContextIds = new Set(['webgl2', 'webgl', 'experimental-webgl'])
    prototype.getContext = function (contextId: string, ...options: unknown[]) {
      if (webglContextIds.has(contextId)) return null
      const getContext = nativeGetContext as (...args: unknown[]) => RenderingContext | null
      return getContext.call(this, contextId, ...options)
    } as typeof prototype.getContext
  })
  await page.reload()
}

function terminalPanel(page: Page): Locator {
  return page.getByTestId('workspace-terminal')
}

function terminalPane(page: Page): Locator {
  return page.locator('[data-terminal-pane]')
}

function paneRows(pane: Locator): Locator {
  return pane.locator('.xterm-rows')
}

async function openTerminalPanel(page: Page) {
  await page.getByRole('button', { name: 'Open terminal' }).click()
  await expect(terminalPanel(page)).toBeVisible()
}

/** The first PTY output (prompt or echo) proves the shell is attached. */
async function expectShellAttached(pane: Locator) {
  await expect
    .poll(async () => (await paneRows(pane).textContent()) ?? '', {
      timeout: SHELL_OUTPUT_TIMEOUT_MS,
    })
    .not.toHaveLength(0)
}

async function runTerminalCommand(page: Page, pane: Locator, command: string) {
  await pane.click()
  await expect(pane.locator('textarea.xterm-helper-textarea')).toBeFocused()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

interface SeededTerminalSession {
  readonly app: OpenWaggleApp
  readonly page: Page
  readonly projectPath: string
  readonly sessionId: string
}

/**
 * Seed one session in a fresh project, restart the app over it, force the DOM
 * terminal renderer, and open the seeded thread. With `worktreeLabel`, the
 * session is seeded in worktree mode with a real directory under
 * `.openwaggle/worktrees/` so the terminal binds to it without a live agent run.
 */
async function launchSessionWithTerminalFixture(
  prefix: string,
  projectLabel: string,
  worktreeLabel?: string,
): Promise<SeededTerminalSession> {
  const app = await OpenWaggleApp.launch(prefix)
  try {
    const projectPath = path.join(app.userDataDir, projectLabel)
    const worktreePath =
      worktreeLabel === undefined
        ? undefined
        : path.join(projectPath, '.openwaggle', 'worktrees', worktreeLabel)
    await fs.mkdir(worktreePath ?? projectPath, { recursive: true })
    const sessionId = await seedSingleSession(app.userDataDir, {
      title: SESSION_TITLE,
      projectPath,
      updatedAt: Date.now(),
      messages: [
        {
          id: 'terminal-fixture-user-message',
          role: 'user',
          createdAt: Date.now() - 1,
          parts: [{ type: 'text', text: SESSION_USER_MESSAGE }],
        },
      ],
      ...(worktreePath === undefined
        ? {}
        : { environmentMode: 'worktree' as const, worktreePath }),
    })
    await app.restart()
    const page = app.window()
    await forceDomTerminalRenderer(page)
    const mainWindow = app.mainWindow()
    await mainWindow.waitUntilReady()
    await mainWindow.openThread(SESSION_TITLE)
    return { app, page, projectPath, sessionId }
  } catch (error) {
    await app.cleanup()
    throw error
  }
}

test('a draft terminal runs in the draft project path', async () => {
  const { app, page, projectPath } = await launchSessionWithTerminalFixture(
    'openwaggle-terminal-draft-e2e-',
    DRAFT_PROJECT_LABEL,
  )

  try {
    await page.getByRole('button', { name: `Collapse ${DRAFT_PROJECT_LABEL}` }).hover()
    await page.getByRole('button', { name: `New session in ${DRAFT_PROJECT_LABEL}` }).click()
    await expect(
      page.getByRole('button', { name: `Draft session in ${DRAFT_PROJECT_LABEL}` }),
    ).toBeVisible()

    await openTerminalPanel(page)
    await expect(terminalPanel(page).getByText(projectPath)).toBeVisible()

    await page.locator('[aria-label="New terminal"]').click()
    const pane = terminalPane(page)
    await expect(pane).toHaveCount(1)
    await expectShellAttached(pane)

    await runTerminalCommand(page, pane, 'pwd')
    await expect(paneRows(pane)).toContainText(DRAFT_PROJECT_LABEL, {
      timeout: SHELL_OUTPUT_TIMEOUT_MS,
    })
  } finally {
    await app.cleanup()
  }
})

test('terminal output survives hiding and re-showing the panel', async () => {
  const { app, page } = await launchSessionWithTerminalFixture(
    'openwaggle-terminal-hide-e2e-',
    'terminal-hide-project',
  )

  try {
    await openTerminalPanel(page)
    await page.locator('[aria-label="New terminal"]').click()
    const pane = terminalPane(page)
    await expect(pane).toHaveCount(1)
    await expectShellAttached(pane)

    await runTerminalCommand(page, pane, `echo ${HIDE_MARKER}`)
    await expect(paneRows(pane)).toContainText(HIDE_MARKER, { timeout: SHELL_OUTPUT_TIMEOUT_MS })

    await terminalPanel(page).locator('[title="Close panel"]').click()
    await expect(terminalPane(page)).toHaveCount(0)

    await page.getByRole('button', { name: 'Open terminal' }).click()
    await expect(terminalPane(page)).toHaveCount(1)
    // The pane remounts onto the same terminal: the replayed scrollback still
    // holds the pre-hide output, and the shell accepts fresh input.
    await expect(paneRows(pane)).toContainText(HIDE_MARKER, { timeout: SHELL_OUTPUT_TIMEOUT_MS })
    await runTerminalCommand(page, pane, `echo ${AFTER_RESHOW_MARKER}`)
    await expect(paneRows(pane)).toContainText(AFTER_RESHOW_MARKER, {
      timeout: SHELL_OUTPUT_TIMEOUT_MS,
    })
  } finally {
    await app.cleanup()
  }
})

test('reloading the window keeps the shell and replays its scrollback on re-attach', async () => {
  const { app, page, projectPath, sessionId } = await launchSessionWithTerminalFixture(
    'openwaggle-terminal-reload-e2e-',
    'terminal-reload-project',
  )

  try {
    await openTerminalPanel(page)
    await page.locator('[aria-label="New terminal"]').click()
    const pane = terminalPane(page)
    await expectShellAttached(pane)
    await runTerminalCommand(page, pane, `echo ${RELOAD_MARKER}`)
    await expect(paneRows(pane)).toContainText(RELOAD_MARKER, { timeout: SHELL_OUTPUT_TIMEOUT_MS })

    const terminalId = await pane.getAttribute('data-terminal-pane')
    expect(terminalId).toBeTruthy()

    await page.reload()
    const mainWindow = app.mainWindow()
    await mainWindow.waitUntilReady()
    await mainWindow.openThread(SESSION_TITLE)

    // The pane remounts after reload and re-attaches through the same
    // openTerminal IPC a mount always uses. A shell that survived the reload
    // must come back carrying its full scrollback (ADR 0030).
    const snapshot = await page.evaluate(
      ({ ownerKey, terminalId, cwd, cols, rows }) => {
        return window.api.openTerminal({ ownerKey, terminalId, cwd, cols, rows })
      },
      {
        ownerKey: String(sessionId),
        terminalId: terminalId ?? '',
        cwd: projectPath,
        cols: OPEN_TERMINAL_DEFAULT_COLS,
        rows: OPEN_TERMINAL_DEFAULT_ROWS,
      },
    )
    expect(snapshot.running).toBe(true)
    expect(snapshot.history).toContain(RELOAD_MARKER)

    // The persisted tab layout rehydrates, so opening the panel remounts the
    // pane and the replay must be visible in the DOM renderer, not just in the
    // service snapshot.
    await page.keyboard.press('Meta+j')
    await page.evaluate(() => {
      document.querySelector('[data-terminal-pane]')?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      )
    })
    await expect
      .poll(
        async () => {
          return page.evaluate(() => {
            const rows = document.querySelector('[data-terminal-pane] .xterm-rows')
            return rows ? (rows.textContent ?? '') : ''
          })
        },
        { timeout: 10_000 },
      )
      .toContain(RELOAD_MARKER)
  } finally {
    await app.cleanup()
  }
})

test('new terminal tabs and the split action create separate panes', async () => {
  const { app, page } = await launchSessionWithTerminalFixture(
    'openwaggle-terminal-tabs-e2e-',
    'terminal-tabs-project',
  )

  try {
    await openTerminalPanel(page)
    const newTerminal = page.locator('[aria-label="New terminal"]')
    await newTerminal.click()
    await newTerminal.click()

    // One close button per tab; pane close buttons only exist once a tab is split.
    await expect(terminalPanel(page).locator('[aria-label^="Close "]')).toHaveCount(2)
    // Only the active tab's panes render into the grid.
    await expect(terminalPane(page)).toHaveCount(1)

    await page.locator('[aria-label="Split terminal"]').click()
    await expect(terminalPane(page)).toHaveCount(2)
    await expect(page.locator('[data-terminal-pane][data-focused="true"]')).toHaveCount(1)
    const [firstPane, secondPane] = await terminalPane(page).all()
    expect(firstPane).toBeDefined()
    expect(secondPane).toBeDefined()
    if (firstPane && secondPane) {
      const [firstId, secondId] = await Promise.all([
        firstPane.getAttribute('data-terminal-pane'),
        secondPane.getAttribute('data-terminal-pane'),
      ])
      expect(firstId).toBeTruthy()
      expect(secondId).toBeTruthy()
      expect(firstId).not.toBe(secondId)
    }
  } finally {
    await app.cleanup()
  }
})

test('a worktree-mode session terminal runs inside the session worktree', async () => {
  const { app, page } = await launchSessionWithTerminalFixture(
    'openwaggle-terminal-worktree-e2e-',
    WORKTREE_PROJECT_LABEL,
    WORKTREE_LABEL,
  )

  try {
    const worktreePath = path.join(
      app.userDataDir,
      WORKTREE_PROJECT_LABEL,
      '.openwaggle',
      'worktrees',
      WORKTREE_LABEL,
    )

    await openTerminalPanel(page)
    // The panel names the session's Working path before any terminal exists.
    await expect(terminalPanel(page).getByText(worktreePath)).toBeVisible()

    await page.locator('[aria-label="New terminal"]').click()
    const pane = terminalPane(page)
    await expect(pane).toHaveCount(1)
    await expectShellAttached(pane)

    await runTerminalCommand(page, pane, 'pwd')
    await expect(paneRows(pane)).toContainText(
      `${WORKTREE_PROJECT_LABEL}/.openwaggle/worktrees/${WORKTREE_LABEL}`,
      { timeout: SHELL_OUTPUT_TIMEOUT_MS },
    )
  } finally {
    await app.cleanup()
  }
})

test('the terminal hotkey toggles the session terminal panel', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-terminal-hotkey-e2e-')

  try {
    const projectPath = path.join(app.userDataDir, 'terminal-hotkey-project')
    await fs.mkdir(projectPath, { recursive: true })
    await seedSingleSession(app.userDataDir, {
      title: SESSION_TITLE,
      projectPath,
      updatedAt: Date.now(),
      messages: [
        {
          id: 'terminal-hotkey-user-message',
          role: 'user',
          createdAt: Date.now() - 1,
          parts: [{ type: 'text', text: SESSION_USER_MESSAGE }],
        },
      ],
    })
    await app.restart()
    const page = app.window()
    const mainWindow = app.mainWindow()
    await mainWindow.waitUntilReady()
    await mainWindow.openThread(SESSION_TITLE)

    const panel = terminalPanel(page)
    await expect(panel).toBeHidden()
    await page.keyboard.press(`${platformModifier()}+j`)
    await expect(panel).toBeVisible()
    await page.keyboard.press(`${platformModifier()}+j`)
    await expect(panel).toBeHidden()
  } finally {
    await app.cleanup()
  }
})
