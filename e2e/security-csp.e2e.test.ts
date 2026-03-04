import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const INLINE_SCRIPT_FLAG = '__OPENWAGGLE_INLINE_SCRIPT_EXECUTED__'

async function launchWithUserData(userDataDir: string) {
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      OPENWAGGLE_USER_DATA_DIR: userDataDir,
    },
  })
}

test('CSP blocks inline script execution in renderer', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-e2e-csp-'))
  const app = await launchWithUserData(userDataDir)

  try {
    const window = await app.firstWindow()
    await expect(window.getByText("Let's build")).toBeVisible()

    const inlineScriptExecuted = await window.evaluate((scriptFlag) => {
      Reflect.set(window, scriptFlag, false)
      const script = document.createElement('script')
      script.textContent = `window.${scriptFlag} = true;`
      document.body.appendChild(script)
      return Reflect.get(window, scriptFlag) === true
    }, INLINE_SCRIPT_FLAG)

    expect(inlineScriptExecuted).toBe(false)
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
