import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'
import { seedSingleSession } from './support/session-fixtures'

const SESSION_TITLE = 'Delayed terminal startup fixture'
const SESSION_USER_MESSAGE = 'Exercise held terminal input during startup.'
const SHELL_OUTPUT_TIMEOUT_MS = 20_000
const STARTUP_PROMPT = 'OWSTART> '
const HELD_INPUT = 'q'.repeat(18)

async function sendNativeHeldKeyWithWindowResizes(app: OpenWaggleApp) {
  await app.electronApplication().evaluate(
    async ({ BrowserWindow }, input) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (window === undefined) throw new Error('Expected the OpenWaggle window.')
      const sendKey = (type: 'keyDown' | 'keyUp') => {
        window.webContents.sendInputEvent({ type, keyCode: input.key })
      }

      sendKey('keyDown')
      for (let index = 1; index < input.repetitions; index += 1) {
        window.setSize(index % 2 === 0 ? 1_180 : 1_260, index % 2 === 0 ? 760 : 820)
        sendKey('keyDown')
        await new Promise<void>((resolve) => setTimeout(resolve, input.intervalMs))
      }
      sendKey('keyUp')
    },
    { intervalMs: 35, key: 'q', repetitions: HELD_INPUT.length },
  )
}

test('held startup input survives native window resizes exactly once on the prompt row', async () => {
  test.skip(process.platform === 'win32', 'The original regression requires a delayed zsh startup.')
  try {
    await fs.access('/bin/zsh')
  } catch {
    test.skip(true, 'The original regression requires /bin/zsh.')
  }

  const startupDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-slow-zsh-'))
  let app: OpenWaggleApp | null = null
  try {
    await fs.writeFile(
      path.join(startupDirectory, '.zshrc'),
      `command sleep 1.3\nPROMPT='${STARTUP_PROMPT}'\nRPROMPT=''\n`,
      'utf8',
    )
    app = await OpenWaggleApp.launch('openwaggle-terminal-held-input-e2e-', {
      environment: { SHELL: '/bin/zsh', ZDOTDIR: startupDirectory },
    })
    const projectPath = path.join(app.userDataDir, 'terminal-held-input-project')
    await fs.mkdir(projectPath, { recursive: true })
    await seedSingleSession(app.userDataDir, {
      title: SESSION_TITLE,
      projectPath,
      updatedAt: Date.now(),
      messages: [
        {
          id: 'terminal-held-input-user-message',
          role: 'user',
          createdAt: Date.now() - 1,
          parts: [{ type: 'text', text: SESSION_USER_MESSAGE }],
        },
      ],
    })
    await app.restart()
    const page = app.window()
    await app.mainWindow().waitUntilReady()
    await app.mainWindow().openThread(SESSION_TITLE)
    await page.getByRole('button', { name: 'Open terminal' }).click()
    await page.locator('[aria-label="New terminal"]').click()

    const pane = page.locator('[data-terminal-pane]')
    await expect(pane).toHaveCount(1)
    await pane.click()
    await expect(pane.locator('textarea.xterm-helper-textarea')).toBeFocused()
    const composer = await page.getByRole('textbox', { name: 'Message input' }).elementHandle()
    if (composer === null) throw new Error('Expected the mounted composer.')
    await sendNativeHeldKeyWithWindowResizes(app)
    expect(await composer.evaluate((element) => element.isConnected)).toBe(true)
    await expect(pane.locator('textarea.xterm-helper-textarea')).toBeFocused()
    await expect(pane).toHaveAttribute('data-readiness', 'ready', {
      timeout: SHELL_OUTPUT_TIMEOUT_MS,
    })

    await expect
      .poll(
        async () =>
          (await pane.locator('.xterm-rows > div').allTextContents()).map((row) => row.trimEnd()),
        { timeout: SHELL_OUTPUT_TIMEOUT_MS },
      )
      .toContain(`${STARTUP_PROMPT}${HELD_INPUT}`)
    const renderedRows = (await pane.locator('.xterm-rows > div').allTextContents()).map((row) =>
      row.trimEnd(),
    )
    expect(renderedRows.filter((row) => row.includes(HELD_INPUT))).toEqual([
      `${STARTUP_PROMPT}${HELD_INPUT}`,
    ])
    expect(renderedRows.join('').match(/q/gu)).toHaveLength(HELD_INPUT.length)
    await app.captureEvidence('terminal-held-input-native-resize')
  } finally {
    try {
      await app?.cleanup()
    } finally {
      await fs.rm(startupDirectory, { recursive: true, force: true })
    }
  }
})
