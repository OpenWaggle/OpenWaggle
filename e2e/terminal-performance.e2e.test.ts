import fs from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { captureHiddenWindowPresentation } from './support/hidden-window-presentation'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'
import {
  runTerminalPaneUsableGate,
  runTerminalReadyKeyDispatchGate,
  runTerminalRendererFloodGate,
  runTerminalRestartUnderFloodGate,
  type TerminalFloodShell,
} from './support/terminal-performance'

const SESSION_TITLE = 'Terminal renderer performance fixture'
const PROJECT_LABEL = 'terminal-renderer-performance-project'

function platformFloodShell(): TerminalFloodShell {
  return process.platform === 'win32' ? 'powershell' : 'posix'
}

test('terminal meets ready-key, pane-usability, flood, and active-restart release gates', async () => {
  test.setTimeout(240_000)
  const app = await OpenWaggleApp.launch('openwaggle-terminal-performance-e2e-')
  let stopPresentation = async () => {}

  try {
    const projectPath = path.join(app.userDataDir, PROJECT_LABEL)
    await fs.mkdir(projectPath, { recursive: true })
    const sessionId = await seedSingleSession(app.userDataDir, {
      title: SESSION_TITLE,
      projectPath,
      updatedAt: Date.now(),
      messages: [
        {
          id: 'terminal-renderer-performance-user-message',
          role: 'user',
          createdAt: Date.now() - 1,
          parts: [{ type: 'text', text: 'Measure the terminal renderer.' }],
        },
      ],
    })
    await app.restart()
    stopPresentation = await captureHiddenWindowPresentation(app.electronApplication())

    const page = app.window()
    const mainWindow = app.mainWindow()
    await mainWindow.waitUntilReady()
    await mainWindow.openThread(SESSION_TITLE)
    await page.getByRole('button', { name: 'Open terminal' }).click()
    await expect(page.getByTestId('workspace-terminal')).toBeVisible()
    // Finish the unmeasured initial shell's startup before creating the test
    // pane. Its profile execution must not overlap the renderer-only gate.
    await expect(page.locator('[data-terminal-pane]')).toHaveAttribute('data-readiness', 'ready', {
      timeout: 90_000,
    })

    const paneUsable = await runTerminalPaneUsableGate({
      page,
      trigger: page.locator('[aria-label="New terminal"]'),
    })
    const pane = page.locator('[data-terminal-pane]')
    await expect(pane).toHaveCount(1)

    const inputDispatch = await runTerminalReadyKeyDispatchGate({
      application: app.electronApplication(),
      ownerKey: sessionId,
      page,
      pane,
    })
    const flood = await runTerminalRendererFloodGate({
      application: app.electronApplication(),
      ownerKey: sessionId,
      page,
      pane,
      shell: platformFloodShell(),
    })
    const restart = await runTerminalRestartUnderFloodGate({
      cwd: projectPath,
      ownerKey: sessionId,
      page,
      pane,
      shell: platformFloodShell(),
    })
    console.info(
      `[terminal-performance] pane usable ${paneUsable.elapsedMs.toFixed(1)}ms; ` +
        `ready-key dispatch p95 ${inputDispatch.p95Ms.toFixed(1)}ms; ` +
        `${flood.floodLines} lines in ${flood.elapsedMs.toFixed(0)}ms; ` +
        `max renderer long task ${flood.maxLongTaskMs.toFixed(1)}ms; ` +
        `paint ${flood.renderedInkBands} bands/${flood.renderedInkPixels} px; ` +
        `renderer ${flood.renderer}` +
        (flood.fallbackReason === null
          ? ''
          : ` (${flood.fallbackReason}${
              flood.fallbackIssues === null ? '' : `: ${flood.fallbackIssues}`
            })`),
    )
    console.info(
      `[terminal-performance] restart under active ${restart.floodLines}-line flood ` +
        `${restart.restartMs.toFixed(1)}ms; generation ` +
        `${restart.oldOutputGeneration}→${restart.replacementOutputGeneration}; ` +
        'replacement shell usable with clean, contiguous output',
    )
    if (flood.fallbackGeometry !== null) {
      console.info(`[terminal-performance] fallback geometry ${flood.fallbackGeometry}`)
    }
  } finally {
    try {
      await stopPresentation()
    } finally {
      await app.cleanup()
    }
  }
})
