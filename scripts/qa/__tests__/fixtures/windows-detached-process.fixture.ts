import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { launchHeadlessBackgroundProcess } from '../../../../src/main/desktop-ui'
import { prepareDesktopUi } from '../../../../src/main/desktop-window-policy'
import { getSafeChildEnv } from '../../../../src/main/env'

const READY_TIMEOUT_MS = 10_000
const CHILD_LIFETIME_MS = 25_000
const POLL_INTERVAL_MS = 25

const [mode, directory] = process.argv.slice(-2)
prepareDesktopUi(app)
if ((mode !== 'parent' && mode !== 'child') || !directory) {
  throw new Error('Detached-process probe requires its mode and private directory.')
}

app.setPath('userData', path.join(directory, mode))

async function publishReady(fileName: string, value: unknown) {
  const filePath = path.join(directory, fileName)
  await fs.writeFile(`${filePath}.tmp`, JSON.stringify(value))
  await fs.rename(`${filePath}.tmp`, filePath)
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function run() {
  await app.whenReady()
  if (mode === 'child') {
    const deadline = Date.now() + CHILD_LIFETIME_MS
    await publishReady('child-ready.json', { pid: process.pid })
    while (Date.now() < deadline && !(await exists(path.join(directory, 'stop-child')))) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    await fs.writeFile(path.join(directory, 'child-stopped'), '')
    app.quit()
    return
  }

  await launchHeadlessBackgroundProcess({
    command: process.execPath,
    args: [path.join(directory, 'fixture.cjs'), 'child', directory],
    environment: { ...getSafeChildEnv(), OPENWAGGLE_AUTOMATION: '1' },
  })
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (!(await exists(path.join(directory, 'child-ready.json')))) {
    if (Date.now() >= deadline) throw new Error('Detached child did not become ready.')
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  await publishReady('parent-ready.json', { pid: process.pid, versions: process.versions })
  app.quit()
}

void run().catch(async (error: unknown) => {
  await fs.writeFile(path.join(directory, `${mode}-error.txt`), String(error))
  app.exit(1)
})
